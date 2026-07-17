# カレンダーの 1 週間 / 1 ヶ月表示

## 目的・背景

TODO「１ヶ月表示、１週間表示」。現状の Calendar タブは「今日の予定」リストと「今後の締切」リストのみで、
先の予定を俯瞰できない。iOS の Calendar タブに **週表示 / 月表示** を追加し、今後の予定と締切をカレンダー上で見られるようにする。

[calendar-change-detection.md](calendar-change-detection.md) の「収集窓の拡張」と土台を共有するため、両タスクは一体で実装する。

## 対応方針

### backend: 収集窓の拡張（変更検知プランと共通の土台）

- `collectCalendar` の収集窓を「今日」→「今日から `CALENDAR_LOOKAHEAD_DAYS` 日（既定 31）」へ拡張する
  - 時刻付きイベント → `events`（窓内すべて。週/月表示のデータ源）
  - 「今日の予定」は `events` から当日分を切り出した `todayEvents` として従来どおり提供（LLM プロンプト・HOME 表示は不変）
  - 終日イベント → 従来どおり `deadlines`（source: 'calendar'）。窓拡張により未来の終日イベントも締切として入る
  - ページネーション対応（`maxResults: 250` + `nextPageToken`。窓が 1 ヶ月に広がるため 50 では足りない可能性）
- `BriefingPayload` に `events?: EventItem[]` を追加（旧アプリ互換のため optional）。LLM プロンプトには従来どおり今日の予定のみ渡す（トークン節約。変更分は変更検知プランのセクションで伝える）
- 管理画面カレンダータブは「今日の予定」→「今後の予定」に改め、日付列を追加

### iOS: Calendar タブの週/月表示

- タブ上部にセグメント（週 / 月）を置き、下に「選択日の予定・締切リスト」を出す 2 段構成
  - **週表示**: 今日を先頭にした 7 日分の横ストリップ。各日セルに曜日・日付と予定/締切の有無ドット
  - **月表示**: 月グリッド（7 列）。‹ › で前後の月へ移動可。予定/締切のある日はドット表示
  - 日セルをタップ → 下のリストがその日の内容に切り替わる（予定 = 時刻順、締切 = DuePill + 完了チェック付きの既存行を再利用）
- データ源は `payload.events`（無い旧 payload は `todayEvents` にフォールバック）+ `payload.deadlines`。
  端末ローカルの暦日で `YYYY-MM-DD` にグルーピングする
- 「今後の締切」一覧セクションは従来どおり残す（締切は日付をまたいで一覧できる方が便利なため）

## 影響範囲

- `backend/src/config.ts` + `.env.example` — `CALENDAR_LOOKAHEAD_DAYS`（既定 31）
- `backend/src/collectors/calendar.ts` — 窓拡張 + todayEvents 切り出し + ページネーション
- `backend/src/collectors/all.ts` / `types.ts` / `llm/briefing.ts` — CollectedInput / BriefingPayload に `events`
- `backend/src/jobs/runBriefing.ts` — collector_runs の calendar raw に events を保存
- `backend/src/admin.ts` + `assets/admin.html` — カレンダータブの「今後の予定」表示
- `ios/AISecretary/Models.swift` — `BriefingPayload.events`
- `ios/AISecretary/Views/CalendarTabView.swift` — 週/月表示

## テスト方針

- `npm run typecheck` / `npm run collectors:check`（実データで窓拡張後の件数を確認）
- iOS シミュレータビルド（xcodegen + xcodebuild）
- 実機で週/月表示・日タップ・締切チェックの動作確認

## Steps

- [x] backend: 収集窓拡張（config + calendar.ts + payload.events + 管理画面）
- [x] iOS: 週表示 / 月表示 + 選択日リスト（シミュレータビルドまで確認）
- [x] 実機確認（2026-07-17）
