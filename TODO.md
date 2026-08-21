# TODO

- タスク追加したらメールする [plan](docs/plans/todo-add-email-notify.md)
  - [x] Step 1: メール送信基盤（gmail.send スコープ追加・src/mail/send.ts・NOTIFY_EMAIL_TO・mail:check・再認証）
  - [x] Step 2: タスク追加ハンドラへの組み込み（/todos/daily・/todos/repo、fire-and-forget）
  - [ ] Step 3: ドキュメント・デプロイ・検証 — ドキュメント（.env.example・deploy-g3plus.md）とローカル検証は完了。残りは g3plus 反映（コード配置・GOOGLE_REFRESH_TOKEN 差し替え・NOTIFY_EMAIL_TO 設定・API 再起動）
