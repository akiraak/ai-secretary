# run-vibeboard.sh の作成

## 目的・背景

vibeboard の起動を 1 コマンドにする。ポート（3011）を既存プロセスが掴んでいる場合は、そのプロセスを停止してから起動する（esl-text-audio の `run-viewer.sh` と同様の挙動）。

## 対応方針

- プロジェクト直下に `run-vibeboard.sh` を作成する
- ポートは `VIBEBOARD_PORT` 環境変数 > `vibeboard.config.json` の `port` > 3011 の順で決定
- `lsof` でポートを掴んでいるプロセスを検出し、`kill`（残れば `kill -9`）してから `node vibeboard/dist/cli.js --root .` を起動する

## 影響範囲

新規スクリプト 1 ファイルのみ。既存コードへの変更なし。

## テスト方針

1. スクリプトで起動し、`http://localhost:3011` が応答することを確認
2. 起動中にもう一度スクリプトを実行し、旧プロセスが停止して新プロセスで起動し直すことを確認
