# 管理画面に GitHub ページを追加

## 目的・背景

iOS アプリには GitHub タブ（更新順リポジトリ一覧 + 昨日の活動）があるが、管理画面には
GitHub の情報が一切表示されない。管理画面（PC）からもブリーフィングに載った GitHub の
状況（リポジトリごとの直近作業サマリー・TODO サマリー・昨日の commits/PR）を確認できる
ようにする。

## 対応方針

### データ源

最新ブリーフィングの payload（`briefings.payload_json`）を使う。

- `payload.repos`（`RepoOverview[]`）: 直近 90 日に push があったリポジトリ最大 20 件
  （pushed_at 降順）。LLM 生成の `recentSummary` / `todoSummary` は payload にしか無いため、
  collector_runs（`github_repos` は join 前の生データ）ではなく payload を採用する。
- `payload.github`（`GithubItem[]`）: 昨日（ブリーフィング日基準）の commits / PR 活動。

鮮度は毎朝のブリーフィング実行に依存（カレンダーページと同じ考え方）。
旧 payload（`repos` 無し）やブリーフィング未生成時は空表示 + 案内文にフォールバック。

### 変更箇所

1. **backend/src/admin.ts**: `getGithubInfo()` を追加。
   最新ブリーフィングから `{ briefingDate, generatedAt, repos, activity }` を組み立てる。
2. **backend/src/server.ts**: `GET /admin/github-info` を追加（/admin 帯なので Bearer なし・
   ADMIN_ENABLED fail-safe の対象）。ヘッダコメントのエンドポイント一覧も更新。
3. **backend/assets/admin.html**: サイドバーに「GitHub」ページを新設（カレンダーの下）。
   - セクション「リポジトリ」: リポジトリ名（GitHub リンク）/ 最終 push / 直近の作業
     （`recentSummary`、無ければ最新コミット 1 行目）/ TODO（件数 + サマリー）
   - セクション「昨日の活動」: リポジトリ / 種別（commit / PR）/ 内容（リンク）
   - `PAGES` / `PAGE_REFRESH` に登録し、ページ表示時に読み込む（ポーリング対象外）

## 影響範囲

- admin.html と admin.ts / server.ts の追加のみ。API（iOS 用）・DB スキーマ・コレクタ・
  LLM 層・iOS アプリは不変。
- /admin 帯の認証方針（Cloudflare Access 前提 + ADMIN_ENABLED fail-safe)も不変。

## テスト方針

1. `npm run typecheck`
2. admin.html の script 部を `node --check` + JS 参照 ID の存在照合
3. ローカル API サーバ + curl で `GET /admin/github-info` の応答確認
   （ブリーフィング有り / ADMIN_ENABLED 無しの 404）
4. headless Chrome で全 7 ページ切り替え・GitHub ページのデータ表示・JS エラーなしを確認 +
   スクリーンショット目視
