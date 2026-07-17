# 管理画面にカレンダータブを追加

## 目的・背景

Canvas 課題の手動完了チェック機能（[plan](canvas-assignment-completion.md)）の続き。
収集済みの「今日の予定」と「今後の締切」（完了状態込み）をブラウザの管理画面からも
確認・操作できるようにする。iOS アプリを開かなくても完了チェックの状態を確認・変更できる。

## 対応方針

### backend

- `GET /admin/calendar-info` を追加（`admin.ts` に集約関数、`server.ts` にルート）
  - `events`: 最新の calendar コレクタ実行（status=ok）の raw_json から今日の予定
  - `deadlines`: 最新の canvas + calendar コレクタ実行の締切をマージし、
    `deadline_completions` の完了フラグを付けて期日順で返す
  - 収集日時（created_at）も添える。ライブで Google/Canvas は叩かない
    （鮮度は毎朝のブリーフィング実行に依存。既存 `/admin/calendars` の設定 API とは別物）
- 完了チェックの更新は既存の `POST /deadlines/complete` をそのまま使う（Bearer 認証は共通）

### 管理画面 UI（admin.html）

- サイドバーに「カレンダー」タブを追加（ダッシュボード / カレンダー / AI 利用状況 の 3 タブ）
- 今日の予定テーブル: 時刻（シアトル）/ 予定 / 場所
- 今後の締切テーブル: 完了チェックボックス（uid のある canvas 締切のみ）/ 期日 / 課題 / コース / ソース
  - チェック操作で `POST /deadlines/complete` → 再描画。完了行は取り消し線 + グレー

## 影響範囲

- `backend/src/admin.ts` / `backend/src/server.ts` / `backend/assets/admin.html`
- DB・コレクタ・iOS は変更なし

## テスト方針

- `npm run typecheck` + admin.html の JS 構文チェック
- 一時 DB に calendar / canvas のコレクタ実行を seed → `GET /admin/calendar-info` を curl 確認、
  `POST /deadlines/complete` 後に完了フラグが反映されること
- `./run-admin.sh` でブラウザ表示・チェック操作を最終確認（手動）
