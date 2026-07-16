# TODO

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [x] Step 1: バックエンド雛形（TS/Node、.env.example、.gitignore、SQLite スキーマ）
  - [x] Step 2: Google OAuth 設定 + Calendar / Gmail コレクタ（backend 用の自前 API アクセス。要ユーザー検証）
  - [x] Step 3: Canvas iCal コレクタ（.ics パース → 締切。ライブ検証は iCal URL 投入後）
  - [x] Step 3.5: GitHub コレクタ（昨日の commits/PR）+ 各リポジトリ TODO.md 読み取り（GitHub API ライブ検証はトークン投入後）
  - [x] Step 4: LLM 層（Claude Haiku 4.5 で日本語ブリーフィング整形・トリアージ。ライブ検証は API キー投入後）
  - [x] Step 5: API（POST /devices, GET /briefings/latest）+ SQLite 保存（`npm start` = API サーバ、`npm run briefing` = 収集→生成→保存ジョブ。一時 DB + curl でライブ検証済み）
  - [ ] Step 6: APNs 送信（.p8/JWT/HTTP2）でデバイスへ push
  - [x] iOS 画面設計（4画面のモックアップ・spec 作成） [spec](docs/specs/ios-app-screens.md)
  - [ ] Step 7: iOS アプリ雛形（通知登録 → トークン送信 → ブリーフィング表示。[画面設計](docs/specs/ios-app-screens.md)に従う）
  - [ ] Step 8: cron で毎朝 07:00 PT 実行 → エンドツーエンド確認
  - [ ] ユーザー作業: Google Cloud で「デスクトップアプリ」OAuth クライアント作成 → ID/SECRET を `.env` → `npm run google:auth` でリフレッシュトークン取得 → `npm run collectors:check` で実データ確認
  - [ ] ユーザー作業: `.env` に Canvas iCal URL / APNs .p8 を投入
  - [ ] ユーザー作業: `.env` に GITHUB_TOKEN（または `gh auth login`）と GITHUB_REPOS を設定 → `npm run collectors:check` で GitHub/TODO セクション確認
  - [ ] ユーザー作業: `.env` に ANTHROPIC_API_KEY を設定 → `npm run llm:check -- --fixture` でトリアージ・要約のライブ確認（実データは `npm run llm:check`）
  - [ ] ユーザー作業: `.env` に API_SHARED_SECRET を設定（ランダム文字列。例: `openssl rand -hex 32`）→ `npm start` で API サーバ起動確認