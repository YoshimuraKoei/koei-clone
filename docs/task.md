# タスク

ライフログ → 将来ファインチューニング用データ蓄積（Slack × Lambda × Supabase × Gemini）向け。

---

## これからやること

優先度の目安：**高**＝学習データの質・一貫性に直結／**中**＝体験・安定・スケール／**低**＝本番化・整備・任意。

### 優先度：高

- [ ] **問いを DB に蓄積**（定時の問いを Supabase に残す、`content.messages` に assistant / user の往復）
- [ ] **`topic` 列に何を入れるか**方針を決め、**コードから `topic` を書き込む**（`scheduler` / `processor` / ハッシュタグ等）
- [ ] **`metadata` 列**（jsonb）と挿入経路（セッション ID、Slack `thread_ts`、品質フラグなど）
- [ ] **receiver**: **スレッド単位**で `content.messages` を **マージ**（※Slack 再送の二重登録防止は済）
- [ ] **個人情報・センシティブ文**をログに混ぜないルール（運用・削除ポリシー）

### 優先度：中

- [ ] **ファインチューニング or RAG 用**に **どのモデル・どの形式で export** するか方針を決める
- [ ] **ファインチューニング用データに「ボットの問い」も含めるか**方針を決める（理想は `assistant`（問い）→ `user`（答え）の往復を同一 `messages` に載せる）
- [ ] **scheduler**: 問いかけの **ランダム化**（プロンプトプール・重複軽減）
- [ ] **scheduler**: **コンテキストを渡すか**を環境変数で切替（例: 前日 `summary`）
- [ ] **processor**: **vector 更新**の安定化（必要なら RPC）
- [ ] **`receiver` は即応答、`worker` Lambda に非同期 Invoke**（Slack 3 秒・負荷分散）
- [ ] **`serverless.yml`** に Worker 用関数・`lambda:InvokeFunction` IAM を追加

### 優先度：低・任意

- [ ] （任意）**本番 stage** 名・リージョン・ログ保持・コスト上限を決める
- [ ] **エクスポート用 CLI**（`messages` を JSONL 等に吐く）
- [ ] **単体テスト**（ハンドラ・ユーティリティ）
- [ ] **`ARCHITECTURE.md`** を **Worker 分離後**のシーケンス・図に更新

### 共有・検討（優先度は状況次第）

- [ ] **問いかけ LLM に渡すコンテキスト**の有無・量（ランダム性 vs 連続性）
- [ ] **Slack 上の UX**（ボット返信を消す・スレッドのみに記録する等）
- [ ] **`topic` の粒度**（1 行 / 複数タグ / 固定カテゴリから選択など）

---

## 完了済

### セットアップ（Slack / AWS / Supabase / Gemini）

- [x] Slack アプリ、Bot Token・Signing Secret、Events API Request URL、ボット招待
- [x] Supabase プロジェクト、`daily_thought_logs`・pgvector、API キー
- [x] Gemini API キー、AWS IAM・CLI・`aws configure`
- [x] 環境変数（`.env` + `useDotenv`）、`scheduler` / `processor` のスケジュール方針反映

### コード・インフラ
- [x] **`useDotenv: true`**（デプロイ時に `.env` を解決）
- [x] **Gemini** チャット/埋め込みモデル（`gemini-2.5-flash-lite` / `gemini-embedding-2-preview`）と API エラーハンドリング
- [x] **SQL** を Git 管理（`sql/001_create_daily_thought_logs.sql` / `sql/002_add_slack_event_id.sql`）
- [x] **`.gitignore`** に `.serverless`
- [x] **scheduler** `cron`（JST 朝 8 時・夜 22 時）
- [x] **processor** 1 日 1 回・未処理最大 10 件/回
- [x] **embedding 次元**（`GEMINI_EMBEDDING_OUTPUT_DIMENSION`・コメント・`vector(1536)`）
- [x] **receiver** `slack_event_id` + UNIQUE で **Events API 再送の二重 insert** を防止
- [x] **README / ARCHITECTURE.md** にデプロイ・3 関数・processor 等を反映（Worker 分離後の図は未）
