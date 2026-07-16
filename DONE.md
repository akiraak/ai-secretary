# DONE

- [x] 2026-07-12 run-vibeboard.sh を作成する（ポート占有プロセスを停止してから起動） [plan](docs/plans/archive/run-vibeboard-script.md)
- [x] 2026-07-14 アプリの機能を決める [plan](docs/plans/archive/decide-app-features.md)
- [x] 2026-07-14 MVP: iOS 画面設計（4画面のモックアップ・spec 作成） [spec](docs/specs/ios-app-screens.md)
- [x] 2026-07-15 MVP Step 1: バックエンド雛形（TS/Node、.env.example、.gitignore、SQLite スキーマ）
- [x] 2026-07-15 MVP Step 2: Google OAuth 設定 + Calendar / Gmail コレクタ（backend 用の自前 API アクセス）
- [x] 2026-07-15 MVP Step 3: Canvas iCal コレクタ（.ics パース → 締切）
- [x] 2026-07-15 MVP Step 3.5: GitHub コレクタ（昨日の commits/PR）+ 各リポジトリ TODO.md 読み取り
- [x] 2026-07-15 MVP Step 4: LLM 層（Claude Haiku 4.5 で日本語ブリーフィング整形・トリアージ）
- [x] 2026-07-15 MVP Step 5: API（POST /devices, GET /briefings/latest）+ SQLite 保存（一時 DB + curl でライブ検証済み）
- [x] 2026-07-15 MVP Step 6: APNs 送信（.p8/JWT/HTTP2 を node 標準モジュールで自前実装。`npm run apns:check` で単体検証）
- [x] 2026-07-15 MVP Step 7: iOS アプリ雛形（SwiftUI 4タブ。シミュレータ + ローカル API でライブ検証済み）
- [x] 2026-07-15 MVP Step 8: cron 実行環境（cron ラッパ + crontab 例 + API 常駐 systemd unit + デプロイ手順書） [手順](docs/specs/deploy-g3plus.md)
- [x] 2026-07-15 MVP: 実機インストール（`Local.xcconfig` に DEVELOPMENT_TEAM 設定 → 実機ビルド → インストール → 起動確認）
