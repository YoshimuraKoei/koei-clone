<div id="top"></div>

## 使用技術一覧

<p style="display: inline">
  <img src="https://img.shields.io/badge/-Node.js-000000.svg?logo=node.js&style=for-the-badge">
  <img src="https://img.shields.io/badge/-TypeScript-3178C6.svg?logo=typescript&style=for-the-badge&logoColor=white">
  <img src="https://img.shields.io/badge/-Amazon%20AWS-232F3E.svg?logo=amazon-aws&style=for-the-badge">
  <img src="https://img.shields.io/badge/-Serverless-FD5750.svg?logo=serverless&style=for-the-badge&logoColor=white">
  <img src="https://img.shields.io/badge/-Slack-4A154B.svg?logo=slack&style=for-the-badge&logoColor=white">
  <img src="https://img.shields.io/badge/-Supabase-3FCF8E.svg?logo=supabase&style=for-the-badge&logoColor=white">
  <img src="https://img.shields.io/badge/-Gemini-4285F4.svg?logo=google&style=for-the-badge&logoColor=white">
</p>

## 目次

1. [プロジェクトについて](#プロジェクトについて)
2. [環境](#環境)
3. [ディレクトリ構成](#ディレクトリ構成)
4. [開発環境構築](#開発環境構築)
5. [トラブルシューティング](#トラブルシューティング)

<br />
<div align="right">
    <a href="ARCHITECTURE.md"><strong>アーキテクチャ（Mermaid） »</strong></a>
</div>
<br />
<div align="right">
    <a href="docs/task.md"><strong>タスク一覧 »</strong></a>
</div>
<br />

## プロジェクト名

koei-clone

## プロジェクトについて

Slack での対話を **Supabase（PostgreSQL + pgvector）** に蓄積し、将来の **ファインチューニング** や **RAG** に使える形式で保存するための **サーバーレス** バックエンドです。

**AWS Lambda**（Serverless Framework v3）で以下を実行します。

- **receiver**: Slack Events API（メッセージ受信・保存）
- **scheduler**: 定時の問いかけ（Gemini で文面生成 → Slack 投稿）
- **processor**: 要約・埋め込みベクトル付与（**1 日 1 回**・未処理最大 10 件/回）

詳細は [ARCHITECTURE.md](ARCHITECTURE.md) を参照してください。

<p align="right">(<a href="#top">トップへ</a>)</p>

## 環境

| 言語・フレームワーク | バージョン（目安） |
| ---------------------- | ------------------ |
| Node.js                | 20.x               |
| TypeScript             | 5.7.x              |
| Serverless Framework   | 3.40.x             |

その他の依存パッケージは [package.json](package.json) と [package-lock.json](package-lock.json) を参照してください。

<p align="right">(<a href="#top">トップへ</a>)</p>

## ディレクトリ構成

```
.
├── ARCHITECTURE.md
├── README.md
├── README_TEMPLATE.md
├── serverless.yml
├── package.json
├── package-lock.json
├── tsconfig.json
├── docs
│   ├── core-image.md
│   ├── input.md
│   └── task.md
└── src
    ├── handlers
    │   ├── processor.ts
    │   ├── receiver.ts
    │   └── scheduler.ts
    └── lib
        ├── gemini.ts
        ├── slack.ts
        └── supabase.ts
```

<p align="right">(<a href="#top">トップへ</a>)</p>

## 開発環境構築

### 前提

- Node.js 20 以上
- AWS アカウントへデプロイする場合: AWS CLI の設定、および Serverless Framework の利用可能な認証情報
- Slack アプリ、Supabase プロジェクト、Gemini API キー

### パッケージのインストール

```bash
npm install
```

### 型チェック

```bash
npm run build
```

### 環境変数

デプロイ前に、シェルまたは CI で [環境変数の一覧](#環境変数の一覧) を設定してください。`serverless.yml` は `${env:変数名}` 形式で参照します。

### デプロイ（AWS）

```bash
npm run deploy
```

（Serverless CLI の `serverless deploy` と同等です。）

### ローカルでの API エミュレーション（任意）

```bash
npm run offline
```

Slack の Request URL には ngrok 等でローカルにトンネルを張り、Events API のエンドポイントに合わせます。

### 環境変数の一覧

| 変数名 | 役割 |
| ------ | ---- |
| `SLACK_SIGNING_SECRET` | Slack リクエストの署名検証 |
| `SLACK_BOT_TOKEN` | Slack Web API（投稿など） |
| `GEMINI_API_KEY` | Google Gemini API |
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase サーバー側書き込み用キー（サーバーのみで保持） |
| `DAILY_PROMPT_TARGET_ID` | 定時投稿先（チャンネル ID またはユーザー ID） |

### コマンド一覧

| npm スクリプト | 実行する処理 |
| -------------- | ------------ |
| `npm run build` | `tsc --noEmit`（型チェック） |
| `npm run deploy` | `serverless deploy`（AWS へデプロイ） |
| `npm run offline` | `serverless offline`（ローカルエミュレーション） |
