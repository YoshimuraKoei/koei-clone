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
  Lambda->>Slack: chat.postMessage（チャンネル）
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
| `SLACK_DAILY_CHANNEL_ID` | 定時投稿先 (プライベートチャンネルのチャンネル ID) |
| `SLACK_OPS_CHANNEL_ID` | 運用保守先 (プライベートチャンネルのチャンネル ID) |
| `OPS_ALERT_EMAIL` | （任意）第二段階: タイムアウト・OOM の CloudWatch アラームを SNS 経由で受け取る Gmail。`serverless.cloudwatch.yml` で定義 |

## エラーハンドリング

アプリ内で拾える失敗は **Slack 運用チャンネル**、Lambda の外側でしか拾えない失敗（タイムアウト・OOM など）は **Gmail（SNS）** に分ける。

### 第一段階: アプリ内 → Slack 運用チャンネル

各 Lambda の `try/catch`（またはエラー分岐）から **`notifyOpsError`** を呼び、運用保守用の Slack チャンネルにエラーメッセージを送信する。Gemini / Supabase / Slack API の失敗など、**処理の途中まで到達した例外**を主に想定する。

```mermaid
flowchart LR
  subgraph fn["Lambda（receiver / scheduler / processor）"]
    A[ハンドラ]
    B[try / catch]
    N["notifyOpsError"]
  end
  subgraph slack["Slack"]
    CH["運用チャンネル<br/>SLACK_OPS_CHANNEL_ID"]
  end
  A --> B
  B -->|"throw や API 失敗"| N
  N -->|"chat.postMessage"| CH
```

**届きにくい例（第一段階だけでは足りない）**

- **タイムアウト** … 実行が打ち切られ、`notifyOpsError` まで到達しないことがある。
- **OOM** … プロセスが落ちるため同様。

### 第二段階: CloudWatch Logs → メトリクス → アラーム → SNS → Gmail

Lambda の標準ログを **メトリクスフィルター**が監視し、**タイムアウト**と **OOM 疑い**の文字列でカスタムメトリクスを増やす。**CloudWatch アラーム**がしきい値を超えたら **SNS トピック**へ publish し、**メールサブスク**先の **Gmail** に届く仕組み。

```mermaid
flowchart TB
  subgraph L["Lambda 実行"]
    LOG["stdout / REPORT<br/>Task timed out / Status:timeout / heap..."]
  end
  subgraph CWLogs["CloudWatch Logs"]
    LG["ロググループ<br/>/aws/lambda/..."]
    MF["メトリクスフィルター<br/>（同一ログに複数パターン可）"]
  end
  subgraph CM["カスタムメトリクス"]
    NS["Namespace: KoeiClone/Phase2<br/>MetricName: ReceiverTimeout 等"]
  end
  subgraph AL["CloudWatch アラーム"]
    ARM["閾値を超えたら ALARM"]
  end
  subgraph SNS["SNS"]
    TOP["トピック<br/>koei-clone-（stage）-ops-alerts"]
  end
  subgraph mail["メール"]
    GM["Gmail（OPS_ALERT_EMAIL）"]
  end
  LOG --> LG
  LG --> MF
  MF --> NS
  NS --> ARM
  ARM -->|"Publish"| TOP
  TOP --> GM
```

**6 本のアラーム**（関数 × 種別）のイメージ:

```mermaid
flowchart TB
  subgraph T["タイムアウト系メトリクス"]
    t1[ReceiverTimeout]
    t2[SchedulerTimeout]
    t3[ProcessorTimeout]
  end
  subgraph O["OOM 系メトリクス"]
    o1[ReceiverOOM]
    o2[SchedulerOOM]
    o3[ProcessorOOM]
  end
  subgraph SNS["SNS トピック（1 本に集約）"]
    TOP["koei-clone-（stage）-ops-alerts"]
  end
  t1 --> TOP
  t2 --> TOP
  t3 --> TOP
  o1 --> TOP
  o2 --> TOP
  o3 --> TOP
```

**検知パターン（例）**

| 種別 | ログ側の目安 |
|------|----------------|
| タイムアウト | JSON の `Task timed out` 相当、または `REPORT` 行の `Status: timeout`（フィルターは両系に対応） |
| OOM 疑い | `heap out of memory` 等 |