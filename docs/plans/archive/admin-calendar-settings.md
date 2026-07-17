# 管理画面からの収集対象カレンダー設定

## 目的・背景

現状、ブリーフィングで収集するカレンダーは `.env` の `GOOGLE_CALENDAR_IDS=primary` に固定されており、
変更するには SSH で `.env` を編集して再起動が必要。Google アカウントの全カレンダー一覧から
収集対象を管理画面（/admin）でチェックボックス選択できるようにする。

## 対応方針

### 保存先: SQLite の `settings` テーブル（key-value）

- `schema.sql` に `settings (key TEXT PRIMARY KEY, value TEXT, updated_at)` を追加（idempotent なので既存 DB にも安全に適用される）
- キー `google_calendar_ids` に選択済みカレンダー ID の JSON 配列を保存
- **フォールバック**: 設定行が無ければ従来どおり `.env` の `GOOGLE_CALENDAR_IDS`（既定 `primary`）を使う。
  既存環境は無変更で動き続ける
- cron の `npm run briefing` は別プロセスだが同じ SQLite を読むので設定は即反映される

### API（いずれも Bearer 認証 + `ADMIN_ENABLED=on` 必須）

- `GET /admin/calendars` — Google の `calendarList.list` で全カレンダー一覧を取得し、
  各項目に `{id, summary, primary, selected}` を付けて返す。`selected` は現在の収集対象かどうか
  （scope は既存の `calendar.readonly` で足りるため OAuth 再認可は不要）
- `PUT /admin/calendars` — `{ids: string[]}` を受け取り settings に保存。
  空配列は「何も収集しない」ではなく設定削除（= `.env` フォールバックに戻す）とするか要検討
  → **空配列はエラー（400）にする**。最低 1 つ選択を必須とし、誤操作で収集ゼロになる事故を防ぐ

### Collector の変更

- `collectCalendar()` が DB の `google_calendar_ids` を優先し、無ければ `config.google.calendarIds` を使う

### 管理画面 UI

- `admin.html` に「収集カレンダー」セクションを追加
  - 「読み込み」で GET /admin/calendars → チェックボックス一覧表示（primary にはバッジ）
  - 「保存」で PUT /admin/calendars
  - Google API を毎回叩くのでダッシュボードの自動 refresh には含めず、明示操作で読み込む

## 影響範囲

- `backend/src/db/schema.sql` — settings テーブル追加
- `backend/src/db/repo.ts` — getSetting / setSetting
- `backend/src/admin.ts` — カレンダー一覧取得・保存ロジック
- `backend/src/server.ts` — GET/PUT /admin/calendars ルート追加
- `backend/src/collectors/calendar.ts` — DB 設定優先の ID 解決
- `backend/assets/admin.html` — 収集カレンダーセクション
- `backend/.env.example` — GOOGLE_CALENDAR_IDS のコメントを「初期値/フォールバック」に更新

## テスト方針

- `npm run typecheck`
- ローカルで `./run-admin.sh` 起動 → curl で
  - `GET /admin/calendars` が実カレンダー一覧を返すこと
  - `PUT /admin/calendars` で保存 → 再 GET で `selected` が反映されること
  - 空配列 PUT が 400 になること
  - 認証なし / ADMIN_ENABLED off で 401 / 404 になること
- `npm run collectors:check` で選択カレンダーから収集されること（DB 設定が優先されること）
- ブラウザで /admin を開き UI 操作を確認

## Steps

- Step 1: DB（schema + repo）と collector のフォールバック解決
- Step 2: API（GET/PUT /admin/calendars）
- Step 3: 管理画面 UI
- Step 4: 検証（typecheck + curl + collectors:check + ブラウザ確認）
