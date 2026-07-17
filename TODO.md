# TODO

- [ ] Canvas 課題の手動完了チェック機能（締切のチェックボックス + SQLite で状態保持） [plan](docs/plans/canvas-assignment-completion.md)
  - [x] backend: DeadlineItem.uid 透過 + schema + repo（掃除含む）
  - [x] backend: GET /deadlines + POST /deadlines/complete
  - [x] backend: runBriefing への completions 反映（LLM 除外 + payload フラグ）
  - [x] iOS: 締切行のチェック UI + API 呼び出し
  - [ ] 本番デプロイ（g3plus で pull + rebuild）+ 実機で保持確認
- カレンダー機能強化
  - [ ] １ヶ月表示、１週間表示
  - [ ] カレンダー変更の検知（前回ブリーフィング以降の追加/変更/削除を朝ブリーフィング + アプリで知らせる） [plan](docs/plans/calendar-change-detection.md)

- [ ] Google Calender への予定を追加
- [ ] kitchen-living のカレンダーを取得