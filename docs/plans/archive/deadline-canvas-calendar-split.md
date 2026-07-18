# 締切表示の Canvas / Google カレンダー分離

## 目的・背景

現在 `payload.deadlines` には Canvas iCal の課題（`source: "canvas"`、既定 7 日先まで）と
Google カレンダーの終日イベント（`source: "calendar"`、最大 31 日先まで）が混在しており、
iOS の HOME「締切が近い」/ カレンダータブ「今後の締切」に一緒に表示されている。

これを次のように分離する:

- **締切** = Canvas のみ。収集は **14 日先まで** に拡張
- **Google カレンダー（終日）** = 別グループとして **直近 7 日間** のみ表示
- カレンダータブでも同様に別グループへ分ける

## 対応方針

backend の payload 構造は変えない（`deadlines` に両ソース混在のまま）。
iOS 側で `source` フィールドにより表示を分離する。これにより旧 payload とも互換が保たれ、
カレンダーグリッドの締切ドット・選択日表示は従来どおり両ソースを扱える。

### Phase 1: backend — Canvas 先読みを 14 日に

- `backend/src/config.ts`: `CANVAS_LOOKAHEAD_DAYS` の既定値 `'7'` → `'14'`
- `backend/.env.example` / `backend/.env`: `CANVAS_LOOKAHEAD_DAYS=14`
- 検証: `npm run typecheck`
- 注意: 本番 (g3plus) の `.env` にも `CANVAS_LOOKAHEAD_DAYS=7` があれば 14 に更新が必要（デプロイ時）

### Phase 2: iOS HOME — 締切は Canvas のみ + カレンダー別グループ

`HomeView.swift` の `sections(_:)`:

- 「締切が近い」: `source == "canvas"` かつ未完了のみ表示
- 新グループ **「カレンダー（直近7日）」**: `source != "canvas"` かつ
  `BriefingDate.daysUntil(dueAt) < 7` の項目を表示。空なら非表示（カレンダーの変更と同じ作法）

### Phase 3: iOS カレンダータブ — 今後の締切を分離

`CalendarTabView.swift` の `deadlinesSection`:

- 「今後の締切」: `source == "canvas"` のみ（未完了先頭 → 完了済み、各グループ dueAt 昇順は維持）
- 新セクション **「カレンダー（直近7日）」**: `source != "canvas"` かつ 7 日以内、dueAt 昇順
- 週/月グリッドのドット・選択日セクション（`deadlinesByDay`）は両ソース混在のまま変更しない

### Phase 4: 仕様書更新・検証・後片付け

- `docs/specs/ios-app-screens.md`: HOME「締切が近い」とカレンダータブの記述を分離後の構成に更新
- シミュレータビルドで検証（新規ファイルなし、xcodegen 不要）
- TODO → DONE 移動、プランを archive へ

## 影響範囲

- backend: `config.ts`（既定値のみ）、`.env` / `.env.example`
- iOS: `HomeView.swift` / `CalendarTabView.swift`（表示ロジックのみ。`Models.swift` 変更なし）
- LLM プロンプト（`briefing.ts` の「## 締切」）は両ソース混在のまま（source ラベル付きで渡している）

## テスト方針

- `cd backend && npm run typecheck`
- `cd ios && xcodebuild -project AISecretary.xcodeproj -scheme AISecretary -destination 'platform=iOS Simulator,name=iPhone 17' build CODE_SIGNING_ALLOWED=NO`
