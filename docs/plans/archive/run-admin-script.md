# run-admin.sh（ローカルで管理画面付き API サーバを起動）

## 目的・背景

ローカル開発時に管理画面（`/admin`）を一発で開けるようにする。既存の `run-vibeboard.sh` と
同じ流儀で、ポートを掴んでいる古いプロセスを停止してから起動する。

## 対応方針

- リポジトリ直下に `run-admin.sh` を新規作成
- ポートは `PORT` 環境変数 > `backend/.env` の `PORT` > 8787 の順で決定
- `lsof -ti tcp:<PORT>` で既存プロセスを graceful kill → 残れば kill -9（run-vibeboard.sh と同じ）
- ブラウザで `http://localhost:<PORT>/admin` を自動で開き（macOS の `open`）、`npm start` を exec

## 影響範囲

- 新規ファイル `run-admin.sh` のみ（backend 本体は変更なし）

## テスト方針

- 既存サーバがポートを掴んだ状態で実行し、置き換わって起動すること
- `GET /admin` が 200 を返すこと
