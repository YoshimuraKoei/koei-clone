1. システムアーキテクチャ（詳細版）
Serverless Framework (sls) を使って、AWS上にデプロイする構成です。

コード スニペット
sequenceDiagram
    participant S as Slack
    participant R as Lambda (Receiver)
    participant W as Lambda (Worker)
    participant G as Gemini API
    participant DB as Supabase (Postgres)

    Note over S, DB: ユーザーの返信フロー
    S->>R: Message Event (POST)
    R-->>W: Async Invoke (非同期呼び出し)
    R-->>S: 200 OK (3秒以内に応答)
    
    W->>DB: 過去の会話コンテキスト取得
    W->>G: ユーザー発言 + 文脈を送信
    G-->>W: 次の質問 or 要約
    
    W->>S: 次の質問を投稿
    W->>DB: 会話ログを保存 (JSONB / Vector)
2. 開発ディレクトリ構造（VS Code想定）
TypeScriptプロジェクトとして、以下のような構造になります。

Plaintext
my-clone-bot/
├── src/
│   ├── handlers/
│   │   ├── receiver.ts    # Slackからの受付（即レス用）
│   │   ├── worker.ts      # メインロジック（Gemini/DB/Slack投稿）
│   │   └── cron.ts        # 22時の定時起動用
│   ├── lib/
│   │   ├── gemini.ts      # Gemini API クライアント
│   │   ├── supabase.ts    # Supabase (pgvector) クライアント
│   │   └── slack.ts       # Slack SDK (Bolt) 
│   └── types/             # TypeScript型定義
├── serverless.yml         # AWSインフラ設定ファイル
├── tsconfig.json          # TSコンパイル設定
└── package.json           # 依存ライブラリ管理
3. serverless.yml の定義案（インフラの心臓部）
ここが解像度の肝です。どのURLにアクセスが来たらどの関数を叩くかを定義します。

YAML
service: my-clone-bot
provider:
  name: aws
  runtime: nodejs20.x
  region: ap-northeast-1
  environment:
    GEMINI_API_KEY: ${env:GEMINI_API_KEY}
    SUPABASE_URL: ${env:SUPABASE_URL}
    SUPABASE_SERVICE_KEY: ${env:SUPABASE_SERVICE_KEY}
    SLACK_BOT_TOKEN: ${env:SLACK_BOT_TOKEN}

functions:
  # Slackからのイベントを受け取る入り口
  receiver:
    handler: src/handlers/receiver.handler
    events:
      - httpApi:
          path: /slack/events
          method: post

  # 重たい処理を担当する裏方
  worker:
    handler: src/handlers/worker.handler
    # Receiverから非同期で呼ばれるため、events設定は不要

  # 毎日22時に自動で問いかけを開始
  scheduledQuestion:
    handler: src/handlers/cron.handler
    events:
      - schedule: cron(0 13 * * ? *) # UTC 13:00 = JST 22:00
4. データセット設計（Supabase）
将来「吉村クローン」をファインチューニングする際、そのまま読み込める形式で保存します。

テーブル名: daily_thought_logs
id: uuid (Primary Key)

content: jsonb

形式: {"messages": [{"role": "user", "content": "..."}, {"role": "model", "content": "..."}]}

理由: OpenAIやGoogleのFine-tuning APIの形式に準拠させておくため。

summary: text

その日の思考の要約。

embedding: vector(1536)

理由: 推薦システムやRAGの「検索用インデックス」として使用。

metadata: jsonb

感情スコア（1-5）、技術タグ、関連プロジェクト名など。

5. 実装上の「こだわり」ポイント
ステート管理（会話の文脈）:
Slackはステートレスなので、数分前のラリーを忘れます。Supabaseのjsonbカラムにその日の未完了の会話を一時保存しておき、Geminiに投げる際に「これまでの流れ」として毎回全件渡すことで、自然な深掘りが可能になります。

定時実行の「パーソナライズ化」:
cron.ts では、ただランダムに聞くのではなく、前日の日記の内容を元に「昨日のあれ、どうなった？」とGeminiに言わせるようにします。これでデータの連続性が生まれます。

開発体験（Local Debugging）:
serverless-offline プラグインを導入することで、VS Code上で npm run dev するだけでローカルにエンドポイントが立ち上がり、デバッグを爆速化します。