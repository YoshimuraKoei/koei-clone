# アーキテクチャ

ライフログ蓄積システム（Slack 対話 → Supabase 保存、定時プロンプト、後処理バッチ）の構成をまとめる。

## システム・コンテキスト

```mermaid
flowchart LR
  subgraph users["利用者"]
    U[ユーザー]
  end

  subgraph slack["Slack"]
    S[ワークスペース / Events API]
  end

  subgraph aws["AWS"]
    APIGW[API Gateway]
    EB[EventBridge<br/>スケジュール]
    R[Lambda: receiver]
    SCH[Lambda: scheduler]
    PRO[Lambda: processor]
  end

  subgraph google["Google"]
    G[Gemini API]
  end

  subgraph data["データ"]
    SB[(Supabase<br/>PostgreSQL + pgvector)]
  end

  U <--> S
  S -->|POST /slack/events| APIGW --> R
  EB --> SCH
  EB --> PRO
  R --> SB
  SCH --> S
  SCH --> G
  PRO --> SB
  PRO --> G
```

## AWS 上のコンポーネント（デプロイ単位）

Serverless Framework が **API Gateway（REST）**、**Lambda**、**EventBridge ルール** などをまとめてデプロイする。関数名とエントリポイントは `serverless.yml` が正。

```mermaid
flowchart TB
  subgraph deploy["serverless.yml to CloudFormation"]
    AG["API Gateway / POST /slack/events"]
    L1[receiver]
    L2[scheduler]
    L3[processor]
    R1["EventBridge cron JST 8 and 22"]
    R2["EventBridge cron daily processor"]
  end

  AG --> L1
  R1 --> L2
  R2 --> L3
```

（`subgraph` タイトルやラベルに **`→`（U+2192）を入れると**、環境によっては矢印トークンと衝突して **syntax error** になります。`<br/>` や `...` もレンダラによっては不安定なので、上記のように **ASCII とスラッシュ区切り**にしています。）

## シーケンス: Slack メッセージ受信（receiver）

Slack は Events API で HTTP POST する。Bolt（`AwsLambdaReceiver`）が署名検証とルーティングを行い、ハンドラ内で Supabase へ保存する（実装はスケルトン含む）。

```mermaid
sequenceDiagram
  autonumber
  participant Slack
  participant APIGW as API Gateway
  participant Lambda as Lambda receiver
  participant Bolt as Bolt / AwsLambdaReceiver
  participant SB as Supabase

  Slack->>APIGW: POST /slack/events
  APIGW->>Lambda: イベント
  Lambda->>Bolt: start() で得たハンドラへ委譲
  Bolt->>Bolt: 署名検証・イベント解析
  alt ユーザーメッセージ等
    Bolt->>SB: daily_thought_logs へ保存
    Bolt->>Slack: chat.postMessage 等（応答）
  end
  Note over Lambda,Slack: 現状の receiver は Gemini を呼ばない。応答文の生成や要約は processor や将来の Worker で行う想定。
```

## シーケンス: 定時の問いかけ（scheduler）

EventBridge のスケジュールで Lambda が起動し、Gemini で問い文を生成してから Slack に投稿する。

```mermaid
sequenceDiagram
  autonumber
  participant EB as EventBridge
  participant Lambda as Lambda scheduler
  participant Gemini as Gemini API
  participant Slack

  EB->>Lambda: スケジュール発火
  Lambda->>Gemini: プロンプト生成（問いかけ文）
  Gemini-->>Lambda: テキスト
  Lambda->>Slack: chat.postMessage（チャンネル or DM）
```

## シーケンス: 後処理バッチ（processor）

`serverless.yml` で **1 日 1 回**起動し、`embedding` が null の行を **最大 10 件**ずつ要約・ベクトル付与する。

```mermaid
sequenceDiagram
  autonumber
  participant EB as EventBridge
  participant Lambda as Lambda processor
  participant SB as Supabase
  participant Gemini as Gemini API

  EB->>Lambda: スケジュール発火（1 日 1 回）
  Lambda->>SB: embedding 未設定行の取得 等
  Lambda->>Gemini: 要約 / 埋め込み用テキスト処理
  Gemini-->>Lambda: 要約・ベクトル
  Lambda->>SB: summary / embedding 更新
```

## データストア（Supabase）

会話は `daily_thought_logs` に JSONB（`messages` 配列）として蓄え、将来のファインチューニングや RAG 用に `summary` と `embedding`（pgvector）を載せる想定。

```mermaid
erDiagram
  daily_thought_logs {
    uuid id PK
    timestamptz created_at
    text topic
    jsonb content
    vector embedding
    text summary
  }
```

必要に応じて `metadata`（jsonb）などを追加し、セッション ID・品質フラグ・Slack の `thread_ts` 等を載せると運用しやすい。

## 環境変数（Lambda 共通）

| 変数 | 用途 |
|------|------|
| `SLACK_SIGNING_SECRET` / `SLACK_BOT_TOKEN` | Slack 署名検証・API 呼び出し |
| `GEMINI_API_KEY` | Gemini（問い生成・要約・埋め込み） |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase へのサーバーサイドアクセス |
| `DAILY_PROMPT_TARGET_ID` | 定時投稿先（チャンネル ID またはユーザー ID） |
| `DAILY_PROMPT_USE_DM` | DM かチャンネルかの切り替え用（実装側で解釈） |

## 補足: 将来の拡張

- **Receiver を即応答専用にし、重い処理を別 Lambda（Worker）へ非同期 Invoke**すると、Slack の 3 秒制限と負荷分散に有利（`docs/core-image.md` の構成に近づく）。
- **埋め込み次元**は利用モデル（例: 768 / 1536）と `vector(n)` を一致させること。
