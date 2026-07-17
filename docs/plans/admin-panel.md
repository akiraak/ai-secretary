# 管理画面（リモートからのブリーフィング実行・状態確認）

## 目的・背景

MVP の残作業「g3plus で `cron-briefing.sh` 手動実行」のために SSH で入る運用を無くしたい。
backend の API サーバはすでに `https://secretary.chobi.me` で公開済みなので、
そこに管理エンドポイントと管理画面を足せば、ブラウザからブリーフィングの手動実行と
状態確認（配信履歴・コレクタ結果・ログ）ができる。以後 g3plus での作業は
「backend 更新時の `git pull` + `systemctl restart`」だけになる。

## 対応方針

フレームワークなし・依存追加なしの既存スタイルを維持する。

1. **`src/admin.ts`（新規）**: 管理ロジック
   - `getStatus()` — 最新ブリーフィング / デバイス一覧（トークンはマスク）/ 直近 collector_runs /
     直近 push_log / 最新ログファイルの末尾 / ジョブ実行状態 を返す
   - `runBriefing()` — `scripts/cron-briefing.sh` を spawn（多重起動はプロセス内ガード + スクリプト側 flock）。
     実行状態と直近の exit code をメモリに保持
2. **`src/server.ts`**: ルート追加
   - `GET /admin` — 静的 HTML（データを含まないため認証なし）
   - `GET /admin/status` — Bearer 認証、JSON
   - `POST /admin/run-briefing` — Bearer 認証、202 を即返し
3. **`assets/admin.html`（新規）**: 単一ファイルの管理画面
   - 共有シークレットを入力（localStorage 保存）→ Bearer で status 取得・実行ボタン
   - 実行中は status をポーリングして完了で自動更新
4. **`db/repo.ts`**: `recentCollectorRuns(limit)` / `recentPushLogs(limit)` を追加（SQL は repo に集約）

## 影響範囲

- backend のみ（`src/server.ts` / `src/admin.ts` / `src/db/repo.ts` / `assets/admin.html`）
- iOS アプリ・cron まわりは変更なし
- 反映には g3plus で `git pull` + `sudo systemctl restart ai-secretary-api` が 1 回必要

## テスト方針

- `npm run typecheck`
- ローカルで一時 DB（`DB_PATH` を scratch に向ける）+ 別ポートでサーバ起動し、
  認証なし 401 / 認証あり status 200 / `POST /admin/run-briefing` 202 → ジョブ完走と
  status への実行結果反映を curl で確認
- ブラウザで `GET /admin` を開き、シークレット入力 → 表示・実行ボタンを目視確認
- g3plus 反映後に `https://secretary.chobi.me/admin` から本番実行 → 実機到達を確認
