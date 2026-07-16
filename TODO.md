# TODO

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [x] Step 1: バックエンド雛形（TS/Node、.env.example、.gitignore、SQLite スキーマ）
  - [x] Step 2: Google OAuth 設定 + Calendar / Gmail コレクタ（backend 用の自前 API アクセス。要ユーザー検証）
  - [x] Step 3: Canvas iCal コレクタ（.ics パース → 締切。ライブ検証は iCal URL 投入後）
  - [ ] Step 3.5: GitHub コレクタ（gh CLI: 昨日の commits/PR）+ 各リポジトリ TODO.md 読み取り
  - [ ] Step 4: LLM 層（Claude Haiku 4.5 で日本語ブリーフィング整形・トリアージ）
  - [ ] Step 5: API（POST /devices, GET /briefings/latest）+ SQLite 保存
  - [ ] Step 6: APNs 送信（.p8/JWT/HTTP2）でデバイスへ push
  - [x] iOS 画面設計（4画面のモックアップ・spec 作成） [spec](docs/specs/ios-app-screens.md)
  - [ ] Step 7: iOS アプリ雛形（通知登録 → トークン送信 → ブリーフィング表示。[画面設計](docs/specs/ios-app-screens.md)に従う）
  - [ ] Step 8: cron で毎朝 07:00 PT 実行 → エンドツーエンド確認
  - [ ] ユーザー作業: Google Cloud で「デスクトップアプリ」OAuth クライアント作成 → ID/SECRET を `.env` → `npm run google:auth` でリフレッシュトークン取得 → `npm run collectors:check` で実データ確認
  - [ ] ユーザー作業: `.env` に Canvas iCal URL / APNs .p8 を投入