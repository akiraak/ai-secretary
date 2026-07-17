# TODO

- カレンダー機能強化
  - [ ] １ヶ月表示、１週間表示 [plan](docs/plans/calendar-week-month-view.md)
    - [x] backend: 収集窓拡張（CALENDAR_LOOKAHEAD_DAYS + payload.events + 管理画面）
    - [x] iOS: 週表示 / 月表示 + 選択日リスト
    - [ ] 実機確認
  - [ ] カレンダー変更の検知（前回ブリーフィング以降の追加/変更/削除を朝ブリーフィング + アプリで知らせる） [plan](docs/plans/calendar-change-detection.md)
    - [x] backend: calendar_items テーブル + diffCalendarItems（単体チェック `npm run diff:check` 付き）
    - [x] backend: collectCalendar に id 保持 + 収集窓拡張（config）
    - [x] backend: runBriefing で差分 → changed 付与 + プロンプト変更セクション + summary ルール
    - [x] iOS: 新規/変更バッジ + 変更一覧表示
    - [ ] 本番デプロイ + 実機で差分表示・briefing 言及を確認

- [ ] Google Calender への予定を追加
- [ ] kitchen-living のカレンダーを取得