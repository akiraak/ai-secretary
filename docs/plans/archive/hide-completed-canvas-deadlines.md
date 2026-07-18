# HOME で完了済み Canvas 締切を非表示 / カレンダータブでは未完了の下に表示

## 目的・背景

Canvas 締切の手動完了チェック（`deadline_completions`）は実装済みだが、iOS の表示は
HOME・カレンダータブとも完了済みを打ち消し線付きで全件表示しており、完了済みが増えると
未完了の締切が埋もれる。

- HOME（統合フィード）は「今やるべきこと」を見る場所なので、完了済みは表示しない
- カレンダータブの「今後の締切」は全件を確認・チェック解除できる場所として残し、
  完了済みを未完了の下にまとめて表示する

## 対応方針

iOS のみの変更（backend は変更なし。payload は従来どおり全件 + `completed` フラグ）。
完了判定は既存の `AppState.isDeadlineCompleted`（サーバ同期 + 楽観更新）を使う。

1. `HomeView.swift` — 「締切が近い」セクションで `payload.deadlines` を
   `!state.isDeadlineCompleted($0)` でフィルタ。全件完了済みなら既存の空メッセージを表示。
   HOME でチェックすると行はその場で消える（解除はカレンダータブで行う）。
2. `CalendarTabView.swift` — `deadlinesSection` のソートを
   「未完了が先 → 各グループ内は dueAt 昇順」に変更。行表示（打ち消し線・チェック解除）は現状維持。

## 影響範囲

- `ios/AISecretary/Views/HomeView.swift`（sections 内の締切セクションのみ）
- `ios/AISecretary/Views/CalendarTabView.swift`（deadlinesSection のソートのみ）
- 月/週カレンダーの締切ドット・選択日セクションは対象外（現状維持）

## テスト方針

- シミュレータビルド（iPhone 17, CODE_SIGNING_ALLOWED=NO）が通ること
- 挙動はロジックが単純（filter / sort）なのでコードレビューで確認。実機での表示確認は
  ユーザーに委ねる
