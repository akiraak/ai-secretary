# Canvas 課題の完了チェック機能（手動）

## 目的・背景

TODO「canvas のカレンダー情報から課題の完了状態を取得できるかチェック / 手動で完了させ状態を保持する機能の検討」の調査結果と設計。

ブリーフィングの締切一覧は Canvas iCal フィード由来だが、提出済み・対応済みの課題も
毎朝並び続けるため「もう終わったもの」と「まだやるもの」が区別できない。

## 調査結果（2026-07-17、実フィードで確認）

`CANVAS_ICAL_URL` の実フィードを取得して中身を確認した（VEVENT 17 件、UID は全て `event-assignment-<id>` 形式）。

- VEVENT に含まれるプロパティは `UID / SUMMARY / DTSTART / DTSTAMP / SEQUENCE / CLASS / DESCRIPTION / X-ALT-DESC / URL` のみ
  - **STATUS / COMPLETED / PERCENT-COMPLETE といった完了系プロパティは存在しない**（VTODO も未使用で、課題は全て VEVENT として配信される）
- 締切が過ぎた課題（7/2〜7/14 締切の in-class 課題等）もフィードに残り続けており、提出・完了で消えたり変化したりしない
- → **結論: iCal フィードから完了状態は取得できない**（app-features.md の「iCal で取れるのは締切のみ、提出状況は取得不可」の想定どおり）

### 代替手段: Canvas REST API（将来オプション）

`/api/v1/planner/items` なら `submissions.submitted / graded` と `planner_override.marked_complete`
（Canvas の Planner 上での手動完了）が取れる。shoreline.instructure.com の API は有効
（未認証で 401 を確認 = 無効化はされていない）。ただし:

- Access Token の生成・管理が必要（Canvas → Account → Settings → New Access Token。失効時の再発行運用も増える）
- in-class 課題（提出物なし）は提出しても `submitted` にならず、API を使っても手動完了は結局必要

→ MVP は**アプリからの手動完了のみ**とし、Canvas API 連携（提出済みの自動チェック）は必要になったら別プランで検討する。

## 対応方針

完了状態のキーは ics の `UID`（`event-assignment-<id>`、課題ごとに安定で締切変更でも変わらない）。
バックエンドの SQLite に完了 UID を保持し、iOS からチェック操作できるようにする。

### DB（schema.sql、idempotent 追加）

```sql
-- 手動で完了にした締切（uid = ics の UID。canvas 由来のみ）
CREATE TABLE IF NOT EXISTS deadline_completions (
  uid          TEXT PRIMARY KEY,
  title        TEXT NOT NULL,                  -- 完了時点の課題名（表示・デバッグ用スナップショット）
  due_at       TEXT NOT NULL,                  -- ISO8601 or YYYY-MM-DD（掃除の基準）
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- 掃除: briefing ジョブの冒頭で `due_at` が 60 日以上前の行を削除（テーブル肥大防止。
  フィード自体が過去の課題をいつまでも含むため「フィードから消えたら削除」は使えない）

### backend

- `DeadlineItem` に `uid?: string` と `completed?: boolean` を追加
- `collectors/canvas.ts`: `parseIcs` が既に取っている `ev.uid` を `DeadlineItem.uid` に透過
  （calendar 由来の締切は uid なし = チェック操作の対象外。MVP は canvas のみ）
- `jobs/runBriefing.ts`: 収集後に completions をマージし、
  - **LLM 入力（プロンプト）と push 判断には未完了のみ**を渡す
  - `payload.deadlines` には `completed` フラグ付きで全件保存（アプリで取り消し線表示できるように）
- API（いずれも Bearer 必須、server.ts に追加）:
  - `GET /deadlines` — 最新の canvas `collector_runs`（status=ok）の raw_json に completions を
    マージして返す（ライブで ics を再取得しない。鮮度は毎朝の briefing 実行に依存でよい）
  - `POST /deadlines/complete` — body `{uid, completed}`。`completed: true` で upsert、
    `false` で行削除（チェック解除）。uid は `event-assignment-` prefix を検証して 400

### iOS

- `Models.swift`: Deadline に `uid` / `completed` を追加（どちらも optional、旧 payload と互換）
- Home / Calendar タブの締切行にチェックボックス。タップで `POST /deadlines/complete`
  （楽観的更新、失敗時に戻す）。completed は取り消し線 + グレー表示
- uid の無い締切（calendar 由来）はチェック非表示

## 影響範囲

- `backend/src/types.ts` — DeadlineItem に uid / completed
- `backend/src/collectors/canvas.ts` — uid 透過
- `backend/src/db/schema.sql` — deadline_completions テーブル
- `backend/src/db/repo.ts` — completions の upsert / delete / 一覧 / 掃除
- `backend/src/server.ts` — GET /deadlines, POST /deadlines/complete
- `backend/src/jobs/runBriefing.ts` — completions マージ（LLM 除外 + payload フラグ）+ 掃除
- `ios/AISecretary/` — Models / APIClient / Home・Calendar の締切行 UI

## テスト方針

- `npm run typecheck`
- curl: `POST /deadlines/complete` → `GET /deadlines` に反映 / `completed: false` で解除 /
  不正 uid が 400 / 認証なしが 401
- `run-admin.sh` で briefing 手動実行 → ログの締切件数が未完了のみになること、
  payload_json に completed が付くこと
- 実機: チェック操作 → アプリ再起動・翌朝の briefing 後も状態が保持されること

## Steps

- [ ] backend: DeadlineItem.uid 透過 + schema + repo（掃除含む）
- [ ] backend: GET /deadlines + POST /deadlines/complete
- [ ] backend: runBriefing への completions 反映（LLM 除外 + payload フラグ）
- [ ] iOS: 締切行のチェック UI + API 呼び出し
- [ ] 本番デプロイ（g3plus で pull + rebuild）+ 実機で保持確認
