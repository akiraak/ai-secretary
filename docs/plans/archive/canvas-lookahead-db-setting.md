# CANVAS_LOOKAHEAD_DAYS の DB 保存化

## 目的・背景

Canvas 締切の先読み日数は `.env` の `CANVAS_LOOKAHEAD_DAYS` でしか変えられず、
本番 (g3plus) では `.env` 編集 + 再デプロイが必要になる。
`google_calendar_ids` と同様に SQLite の `settings` テーブルへ保存し、
管理画面 (`/admin`) から変更できるようにする。

## 対応方針

既存の設定パターン（`settings.ts`: DB 優先 → `.env` フォールバック）を踏襲する。

- `backend/src/settings.ts`
  - キー `canvas_lookahead_days`（値は JSON 数値文字列）
  - `resolveCanvasLookaheadDays(): number` — DB 設定を優先し、無効/未設定なら `config.canvas.lookaheadDays`
  - `saveCanvasLookaheadDays(days)` — 1〜60 の整数のみ許可
- `backend/src/collectors/canvas.ts`
  - `extractDeadlines` に `lookaheadDays` 引数を追加（DB 非依存のまま保つ）
  - `collectCanvas` が `resolveCanvasLookaheadDays()` を渡す
- `backend/src/admin.ts` + `src/server.ts`
  - `GET /admin/settings` → `{ canvasLookaheadDays, source: 'db' | 'env' }`
  - `PUT /admin/settings` → `{ canvasLookaheadDays }` を検証して保存
- `backend/assets/admin.html`
  - ダッシュボードの「収集カレンダー」の下に「収集設定」カードを追加
  - 数値入力 + 保存ボタン。認証時に一度だけ読み込む（3 秒ポーリングでは上書きしない）
- `backend/src/db/schema.sql` — settings テーブルのコメントにキーを追記（DDL 変更なし）

## 影響範囲

- backend のみ（iOS 変更なし）。`.env` の `CANVAS_LOOKAHEAD_DAYS` はフォールバックとして残る
- DB 設定を保存した後は `.env` の値より DB が優先される（g3plus でも管理画面から変更可能に）

## テスト方針

- `npm run typecheck`
- 一時 DB + `ADMIN_ENABLED=on` でサーバを起動し、`GET/PUT /admin/settings` を curl で検証
  （PUT → GET で反映確認、範囲外の値が 400 になること）
