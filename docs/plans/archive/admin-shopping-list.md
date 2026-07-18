# 管理画面に買い物リストページを追加

## 目的・背景

- kitchen-living の買い物リストコレクタ（[shopping-list-collector.md](shopping-list-collector.md)）で
  未購入品を朝のブリーフィングに載せたが、管理画面からは見られない
- 管理画面（/admin）にも買い物リストを表示し、ブラウザから現在の未購入品を確認できるようにする

## 対応方針

- `GET /admin/shopping`（要 Bearer 認証）を追加: `collectShopping()` を**ライブ実行**して
  `{ fetchedAt, items }` を返す（カレンダータブと違い収集結果の保存を待たない。
  API 1 本で安価・常に最新のため。外部 API 失敗は /admin/calendars と同じく 502 + 理由）
- `assets/admin.html`: サイドバーに「買い物リスト」ページを追加
  - 表: 品名 / 追加元（レシピ・手動） / 追加日時（シアトル時刻）
  - ページを開いたとき自動読み込み + 「再読み込み」ボタン
- `src/admin.ts` に `getShoppingList()` を追加、`src/server.ts` にルーティングとヘッダコメント追記

## 影響範囲

- backend の admin 系（server.ts / admin.ts / assets/admin.html）のみ。iOS・payload・DB は不変

## テスト方針

- `npm run typecheck`
- admin.html の script を抽出して `node --check`（JS 構文エラーでページ全体が死ぬのを防ぐ）
- ローカルで ADMIN_ENABLED=on のサーバを起動し、curl で
  `/admin/shopping`（正常 + 認証なし 401）と `/admin` の HTML に新ページが含まれることを確認

## 決定記録

- 2026-07-18: ユーザー指示で着手
