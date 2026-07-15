# TODO

- [ ] アプリの機能を決める [plan](docs/plans/decide-app-features.md)
  - [x] Google カレンダーの把握（MCP 認証済み、6 カレンダー調査）
  - [x] Gmail の把握（受信は通知中心・自分宛て自動配信 200 通/90日）
  - [x] github の作業リポジトリの把握（プライベート含む全 90 件）
  - [x] ESL学校の canvas の把握（shoreline.instructure.com、Access Token は管理者が無効化 → iCal フィードに確定）
  - [x] アイデア出し（実データ調査を反映済み） [spec](docs/specs/app-features.md)
    - 管理するもの
    - ユーザーのインターフェース（情報をどのように表示や通知をするか）
  - [x] 通知チャネルの決定 → MVP から ネイティブ iOS アプリ + 自前 APNs（[検証 2-2-1](docs/specs/app-features.md)）
  - [ ] ユーザー確認: Canvas の iCal URL / Apple Developer 加入状況 / push ペイロード方式 / ブリーフィング時刻・言語
  - [ ] 機能とMVPスコープの最終決定（→ 決まり次第 MVP 実装プランを作成）

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [ ] Step 1: バックエンド雛形（TS/Node、.env.example、.gitignore、SQLite スキーマ）
  - [ ] Step 2: Google OAuth 設定 + Calendar / Gmail コレクタ（backend 用の自前 API アクセス）
  - [ ] Step 3: Canvas iCal コレクタ（.ics パース → 締切）
  - [ ] Step 3.5: GitHub コレクタ（gh CLI: 昨日の commits/PR）+ 各リポジトリ TODO.md 読み取り
  - [ ] Step 4: LLM 層（Claude Haiku 4.5 で日本語ブリーフィング整形・トリアージ）
  - [ ] Step 5: API（POST /devices, GET /briefings/latest）+ SQLite 保存
  - [ ] Step 6: APNs 送信（.p8/JWT/HTTP2）でデバイスへ push
  - [x] iOS 画面設計（4画面のモックアップ・spec 作成） [spec](docs/specs/ios-app-screens.md)
  - [ ] Step 7: iOS アプリ雛形（通知登録 → トークン送信 → ブリーフィング表示。[画面設計](docs/specs/ios-app-screens.md)に従う）
  - [ ] Step 8: cron で毎朝 07:00 PT 実行 → エンドツーエンド確認
  - [ ] ユーザー作業: `.env` に Canvas iCal URL / Google リフレッシュトークン / APNs .p8 を投入