# TODO

- [ ] MVP: 朝ブリーフィングを iOS アプリに push [plan](docs/plans/mvp-morning-briefing.md)
  - [ ] ユーザー作業: 手動で実装確認（ブリーフィング生成後に実機で一通り触る）
    - [ ] Setting タブ: 「バックエンド登録」が「登録済み」、接続テストが ✓ になる
    - [ ] 通知バナーをタップ → HOME が開いて日本語ブリーフィングが表示される
    - [ ] HOME タブ: 統合フィード（予定・締切・要対応メール・GitHub 活動・TODO）が実データで表示される
    - [ ] GitHub タブ / Calendar タブにそれぞれ実データが表示される
    - [ ] プルリフレッシュで最新ブリーフィングを取り直せる
  - [ ] 翌朝 07:00 PT の cron 自動配信を確認（`backend/logs/briefing-*.log` のタイムスタンプ + 実機バナー）
