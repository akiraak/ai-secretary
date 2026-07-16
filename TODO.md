# TODO

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [ ] ユーザー作業: 実機で通知許可 → Setting タブでデバイス登録を確認（要 API サーバ起動。実機インストール・起動確認は完了済み）
  - [ ] ユーザー作業: Google Cloud で「デスクトップアプリ」OAuth クライアント作成 → ID/SECRET を `.env` → `npm run google:auth` でリフレッシュトークン取得 → `npm run collectors:check` で実データ確認
  - [ ] ユーザー作業: `.env` に Canvas iCal URL / APNs 設定（APNS_KEY_ID / TEAM_ID / BUNDLE_ID / P8_PATH）を投入 → `npm run apns:check -- --token <デバイストークン>` で実機到達確認
  - [ ] ユーザー作業: `.env` に GITHUB_TOKEN（または `gh auth login`）と GITHUB_REPOS を設定 → `npm run collectors:check` で GitHub/TODO セクション確認
  - [ ] ユーザー作業: `.env` に ANTHROPIC_API_KEY を設定 → `npm run llm:check -- --fixture` でトリアージ・要約のライブ確認（実データは `npm run llm:check`）
  - [ ] ユーザー作業: `.env` に API_SHARED_SECRET を設定（ランダム文字列。例: `openssl rand -hex 32`）→ `npm start` で API サーバ起動確認
  - [ ] ユーザー作業: g3plus へデプロイ（`npm ci` → `.env`/`.p8` 配置 → systemd で API 常駐 → crontab 登録）→ `scripts/cron-briefing.sh` 手動実行で iOS 実機到達を確認 → 翌朝 07:00 PT の cron 配信を確認 [手順](docs/specs/deploy-g3plus.md)