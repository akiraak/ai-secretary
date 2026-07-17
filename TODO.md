# TODO

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [x] ユーザー作業: Google Cloud で「デスクトップアプリ」OAuth クライアント作成 → ID/SECRET を `.env` → `npm run google:auth` でリフレッシュトークン取得 → `npm run collectors:check` で実データ確認
  - [x] ユーザー作業: APNs 認証キー作成（Key ID `5FYQTB5C3B`。正本は `~/Keys/apple/AuthKey_5FYQTB5C3B.p8`、チーム共用キーなので他アプリでも再利用可）→ `.env` に APNS_KEY_ID / P8_PATH を投入 → `apns:check -- --fixture` パス + 実 APNs でキー認証確認済み（ダミートークンに `400 BadDeviceToken` = JWT 受理）
  - [x] ユーザー作業: 実機で通知許可 → Setting タブでデバイス登録を確認（`run-ios-device.sh` の接続先焼き込みで手入力なしに登録。DB に ios デバイス 1 台登録済み）
  - [x] `npm run apns:check` で実機到達確認（登録デバイス宛て送信成功・実機でバナー表示を確認）
  - [ ] ユーザー作業: g3plus へデプロイ（`npm ci` → `.env`/`.p8` 配置 → systemd で API 常駐 → crontab 登録）→ `scripts/cron-briefing.sh` 手動実行で iOS 実機到達を確認 → 翌朝 07:00 PT の cron 配信を確認 [手順](docs/specs/deploy-g3plus.md)
