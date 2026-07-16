# TODO

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [x] ユーザー作業: Google Cloud で「デスクトップアプリ」OAuth クライアント作成 → ID/SECRET を `.env` → `npm run google:auth` でリフレッシュトークン取得 → `npm run collectors:check` で実データ確認
  - [ ] ユーザー作業: `.env` に APNs 設定（APNS_KEY_ID / P8_PATH。TEAM_ID / BUNDLE_ID は設定済み）を投入 → `npm run apns:check -- --token <デバイストークン>` で実機到達確認
  - [ ] ユーザー作業: 実機で通知許可 → Setting タブでデバイス登録を確認（要 API サーバ起動。実機インストール・起動確認は完了済み）
  - [ ] ユーザー作業: g3plus へデプロイ（`npm ci` → `.env`/`.p8` 配置 → systemd で API 常駐 → crontab 登録）→ `scripts/cron-briefing.sh` 手動実行で iOS 実機到達を確認 → 翌朝 07:00 PT の cron 配信を確認 [手順](docs/specs/deploy-g3plus.md)
