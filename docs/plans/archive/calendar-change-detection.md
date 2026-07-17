# カレンダー変更の検知（前回ブリーフィング以降の差分を知らせる）

## 目的・背景

TODO「カレンダーの情報が変更されたときはわかるように」。予定・締切は毎朝の収集で取り込むが、
「昨日と何が変わったか（新しい予定が入った / 時間が動いた / キャンセルされた）」が分からない。
朝ブリーフィングと iOS アプリで **前回のブリーフィング以降の変更** を分かるようにする。

## 調査結果（2026-07-17、実装・実フィードで確認）

変更検知に使える識別子と変更マーカーがあるかを確認した。

### Google カレンダー（検知可能・強い）

- 収集は googleapis の `cal.events.list`。各 item は **安定 `id`**・`updated`(RFC3339)・`etag`・
  削除時 `status: 'cancelled'` を持つ（現行コレクタは `id` を捨てているが、保持すればキーに使える）
- → **追加 / 変更（時刻・タイトル・場所）/ 削除** すべて検知できる
- 注意: 現行コレクタは収集窓が **「今日」だけ**。翌日以降の予定変更を拾うには窓を数日先まで広げる必要がある
  （TODO「1週間/1ヶ月表示」と方向が一致するので、そこと一緒に広げる）

### Canvas iCal（追加・変更は可 / 削除は不可）

- 各 VEVENT は安定 `UID`（`event-assignment-<id>`）+ `SEQUENCE`（変更で増える）+ `DTSTAMP` を持つ
- → **追加**（新 UID）と **変更**（SEQUENCE 増加 or 締切日変更）は検知できる
- **削除は検知不可**（[canvas-assignment-completion.md](canvas-assignment-completion.md) で確認したとおり、フィードは
  過去・完了分を保持し続け、消えたり status も付かない）→ Canvas は「削除」を主張しない

## 対応方針

### 方式: スナップショット差分（syncToken は使わない）

毎回、収集窓の内容を正規化してキー付きで保存し、前回保存分と突き合わせて追加/変更/削除を出す。
Google の syncToken 増分同期は timeMin/orderBy と併用できず 410 full-resync 処理も要るため、
1 日 1 回の用途にはスナップショット差分の方が単純で堅い。

### DB（schema.sql、idempotent 追加）

```sql
-- カレンダー/締切の変更検知用スナップショット（前回ブリーフィング時点の状態）
CREATE TABLE IF NOT EXISTS calendar_items (
  key         TEXT PRIMARY KEY,   -- 'gcal:<eventId>' / 'canvas:<uid>'
  source      TEXT NOT NULL,      -- calendar | canvas
  fingerprint TEXT NOT NULL,      -- 変更検知用: calendar=start|end|title|location / canvas=dueAt|title
  start_at    TEXT NOT NULL,      -- 窓スクロールアウトの誤「削除」判定を防ぐ基準
  title       TEXT NOT NULL,      -- 変更メッセージ表示用スナップショット
  last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 差分ロジック（`diffCalendarItems`）

1. 今回収集分から `{key, fingerprint, start_at, title, source}` の一覧を作る
2. `calendar_items` を全読み込みして map 化
3. 分類:
   - **新規 (new)**: 今回のキーが前回に無い
   - **変更 (updated)**: キーは在るが fingerprint が違う（→ 何が変わったかは start/title/location の比較で文言化）
   - **削除 (removed)**: 前回に在るが今回に無い。**ただし** `source=calendar` かつ `start_at >= 今日` のものだけ
     （窓が毎日ずれて過去化しただけの予定を「削除」と誤検知しない）。`source=canvas` は削除を出さない
4. `calendar_items` を今回の状態に更新（new/updated を upsert、削除確定分を delete）
5. **初回（テーブルが空）はベースライン投入のみで変更フラグを立てない**（初回デプロイ時に全件「新規」で溢れるのを防ぐ）

### 型（types.ts）

- `EventItem` に `id: string`（キー用）と `changed?: 'new' | 'updated'` を追加
- `DeadlineItem` に `changed?: 'new' | 'updated'` を追加（`uid` は canvas-completion 側で追加済みを前提）
- 変更一覧を payload に載せる: `BriefingPayload.calendarChanges?: CalendarChange[]`
  （`{kind: 'new'|'updated'|'removed', source, title, detail}`。アプリで「変更」セクション表示にも使える）

### 収集の変更

- `collectors/calendar.ts`: `ev.id` を `EventItem.id` に保持。収集窓を `CALENDAR_LOOKAHEAD_DAYS`（既定 14）まで拡張し、
  「今日の予定」は当日ぶんのサブセットとして切り出す（週/月表示 TODO の布石）。**窓拡張が重ければ MVP は今日のみのままでも可**
  （その場合の変更検知は「今日の予定の変化」に限定される）
- `collectors/canvas.ts`: `uid` を透過（canvas-completion 側で対応済み）。fingerprint 用に `dueAt` を使う

### 朝ブリーフィングでの通知（LLM）

- `runBriefing.ts` が差分を計算し、変更一覧を `buildUserPrompt` に渡す
- `buildUserPrompt` に「## カレンダーの変更（前回のブリーフィング以降）」セクションを追加し、new/updated/removed を列挙
- `SYSTEM_PROMPT` の summary ルールに「重要な変更があれば件数付きで触れる」を追記
  → push 本文が「◯◯の予定が△△に変更 / 新しい予定 N 件」と自然に言及する
- 変更が無い日は空セクション（LLM は触れない）

### iOS

- payload の `changed` / `calendarChanges` を使い、Home・Calendar の該当行に「新規」「変更」バッジ表示
  （週/月表示が入ればカレンダー上でも色分け）。旧 payload 互換のため全て optional

## 影響範囲

- `backend/src/types.ts` — EventItem.id/changed, DeadlineItem.changed, CalendarChange, BriefingPayload.calendarChanges
- `backend/src/collectors/calendar.ts` — id 保持 + 収集窓拡張
- `backend/src/db/schema.sql` — calendar_items テーブル
- `backend/src/db/repo.ts`（or 新規 `db/calendarDiff.ts`）— 読み込み / upsert / delete / diff
- `backend/src/jobs/runBriefing.ts` — 差分計算 → changed 付与 → プロンプトへ変更一覧
- `backend/src/llm/briefing.ts` — プロンプトに変更セクション + summary ルール追記
- `backend/src/config.ts` + `.env.example` — CALENDAR_LOOKAHEAD_DAYS
- `ios/AISecretary/` — Models / 変更バッジ表示

## スコープ外（将来）

- **リアルタイム検知 + 即時 push**（日中に予定が変わった瞬間に通知）: 別の定期ジョブ（N 分おきポーリング）+
  変更 push の重複抑制が必要で、朝ブリーフィング 1 本の現構成から大きく外れる。まずは「毎朝の差分」を出す本プランを入れてから検討
- Canvas の「削除」検知: フィード構造上不可。必要なら Canvas REST API（要 Access Token）で別途

## テスト方針

- `npm run typecheck`
- `diffCalendarItems` の単体: fixture で new / updated / removed（future のみ）/ canvas は removed 出さない /
  初回はベースラインのみ、を検証
- `run-admin.sh` で briefing を 2 回（間で予定を 1 件変更）→ 2 回目の summary が変更に言及、payload に calendarChanges
- 実機: バッジ表示と、翌朝の briefing で前日差分が出ることを確認

## 実装メモ（2026-07-17、プランからの差分）

- 収集窓の既定は **31 日**（`CALENDAR_LOOKAHEAD_DAYS`。週/月表示プランと共用のため 14 から変更）
- **窓末端スクロールインの new 抑止**: 窓が毎日 1 日ずれるため、窓の最終日（today + N - 1）以降に
  始まる新出項目は「窓に入っただけ」とみなし new を出さない（`newCutoff`）
- **ベースラインはソース単位**: `calendar_items` にそのソースの行が無ければ初回とみなす
  （初回デプロイ時に片方のコレクタだけ失敗しても、後日そのソースが全件「新規」で溢れない）
- スナップショット更新は**ソース単位の丸ごと置き換え**（`replaceCalendarItems`。upsert/delete の個別管理より単純）
- コレクタが失敗したソースは差分もスナップショット更新もスキップ（空収集による全件「削除」誤検知の防止）
- diff ロジックは `src/jobs/calendarDiff.ts`（純粋関数）+ SQL は `db/repo.ts`。単体検証は `npm run diff:check`
- 変更一覧はアプリでは HOME のカード + Calendar タブの「カレンダーの変更」セクションに表示

## Steps

- [x] backend: calendar_items テーブル + diffCalendarItems（単体チェック `npm run diff:check` 付き）
- [x] backend: collectCalendar に id 保持 + 収集窓拡張（config）
- [x] backend: runBriefing で差分 → changed 付与 + プロンプト変更セクション + summary ルール
- [x] iOS: 新規/変更バッジ + 変更一覧表示（シミュレータビルドまで確認）
- [x] 本番デプロイ + 実機で差分表示・briefing 言及を確認（2026-07-17）
