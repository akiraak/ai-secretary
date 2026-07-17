# TODO

- [ ] LLM 呼び出しの混雑リトライ: 429/5xx/529 を 30s→60s→120s の間隔で再試行（本番で 529 連発により手動実行が失敗したため） [plan](docs/plans/llm-retry.md)
  - [x] briefing.ts に createMessageWithRetry を実装（typecheck + `llm:check -- --fixture` で実 API 成功を確認）
  - [ ] コミット → g3plus 反映（翌朝 07:00 PT の cron までに反映しておくと混雑に強くなる）

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [x] ユーザー作業: Google Cloud で「デスクトップアプリ」OAuth クライアント作成 → ID/SECRET を `.env` → `npm run google:auth` でリフレッシュトークン取得 → `npm run collectors:check` で実データ確認
  - [x] ユーザー作業: APNs 認証キー作成（Key ID `5FYQTB5C3B`。正本は `~/Keys/apple/AuthKey_5FYQTB5C3B.p8`、チーム共用キーなので他アプリでも再利用可）→ `.env` に APNS_KEY_ID / P8_PATH を投入 → `apns:check -- --fixture` パス + 実 APNs でキー認証確認済み（ダミートークンに `400 BadDeviceToken` = JWT 受理）
  - [x] ユーザー作業: 実機で通知許可 → Setting タブでデバイス登録を確認（`run-ios-device.sh` の接続先焼き込みで手入力なしに登録。DB に ios デバイス 1 台登録済み）
  - [x] `npm run apns:check` で実機到達確認（登録デバイス宛て送信成功・実機でバナー表示を確認）
  - [x] ユーザー作業: g3plus へデプロイ（`npm ci` → `.env`/`.p8` 配置 → systemd で API 常駐 → crontab 登録。公開 URL は `https://secretary.chobi.me`、Cloudflare 経由。認証付き curl で 404 = 稼働確認済み） [手順](docs/specs/deploy-g3plus.md)
  - [x] iOS アプリを本番向けに切替: `run-ios-device.sh --prod` で `https://secretary.chobi.me` を焼き込み（接続先切替時に自動で再登録する AppState 修正込み。実機で URL 表示を確認済み）
  - [x] ブリーフィングを本番で手動実行 → 実機到達確認: 管理画面 API `run-briefing` で生成 → push `sent`（2026-07-16 23:45 PT、briefings.id=2。初回 2 回は Anthropic 529 で失敗 → LLM リトライを別タスクで対応）
  - [ ] ユーザー作業: 手動で実装確認（ブリーフィング生成後に実機で一通り触る）
    - [ ] Setting タブ: 「バックエンド登録」が「登録済み」、接続テストが ✓ になる
    - [ ] 通知バナーをタップ → HOME が開いて日本語ブリーフィングが表示される
    - [ ] HOME タブ: 統合フィード（予定・締切・要対応メール・GitHub 活動・TODO）が実データで表示される
    - [ ] GitHub タブ / Calendar タブにそれぞれ実データが表示される
    - [ ] プルリフレッシュで最新ブリーフィングを取り直せる
  - [ ] 翌朝 07:00 PT の cron 自動配信を確認（`backend/logs/briefing-*.log` のタイムスタンプ + 実機バナー）
