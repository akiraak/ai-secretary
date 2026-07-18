# HOME / Calendar タブの「カレンダーの変更」セクション非表示

## 目的・背景

前回ブリーフィング以降のカレンダー差分（新規 / 変更 / 削除）を表示する「カレンダーの変更」セクションが
HOME と Calendar タブの両方にあるが、表示不要と判断したため非表示にする（TODO: 「hone, calender のカレンダーの変更は非表示に」）。

## 対応方針

iOS 側の表示のみ削除する。backend の収集・payload（`calendarChanges`）・ブリーフィング本文への反映は変更しない
（データは残るので、将来再表示したくなったら UI を戻すだけでよい）。

- `ios/AISecretary/Views/HomeView.swift` — `sections(_:)` 内の「カレンダーの変更」SectionCard を削除
- `ios/AISecretary/Views/CalendarTabView.swift` — `changesSection` の定義と `body` からの参照を削除、冒頭コメントも更新
- `ios/AISecretary/Components.swift` — 上記 2 箇所でのみ使っていた `CalendarChangeRow` を削除
- `ios/AISecretary/Models.swift` の `calendarChanges` / `CalendarChange` は backend `types.ts` と 1:1 のため残す

## 影響範囲

iOS アプリの表示のみ。payload 構造・backend・push は不変。

## テスト方針

`xcodegen generate` 後、iPhone 17 シミュレータ向け `xcodebuild` が通ることを確認する。
