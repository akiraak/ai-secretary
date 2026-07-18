# GitHub 画面の拡充: 更新順リポジトリ一覧 + サマリー + 詳細画面

## 目的・背景

現在の GitHub タブは「昨日の活動（commits/PR）」と「次の作業（各 TODO.md の全文）」の
2 セクションをリポジトリ名のアルファベット順で並べているだけで、

- どのリポジトリが最近動いているか（更新順）が分からない
- リポジトリごとに「直近何をやっていたか」「次に何をやるか」が一目で分からない
- 1 リポジトリを掘り下げる画面がない

これを「更新順のリポジトリ一覧（直近作業サマリー + TODO サマリー付き）→ タップで詳細画面」
という構成に刷新する。

## 対応方針

### 全体アーキテクチャ

既存の「毎朝のブリーフィング生成時にデータを揃え payload に含める」モデルを維持する。
オンデマンドで GitHub API を叩く新エンドポイントは作らない
（アプリのデータ源は GET /briefings/latest のまま。レイテンシ・レート制限・認証の複雑化を避ける）。

`BriefingPayload` に新セクション `repos?: RepoOverview[]` を追加する:

```ts
/** 詳細画面用の直近コミット 1 件 */
interface RepoCommit {
  message: string; // 1 行目のみ
  date: string;    // ISO8601
  url?: string;
}

/** リポジトリ 1 つ分の概要（GitHub タブの一覧 + 詳細画面のデータ源） */
interface RepoOverview {
  repo: string;           // owner/name
  url: string;            // https://github.com/owner/name
  pushedAt: string;       // ISO8601。更新順ソートキー
  commits: RepoCommit[];  // 直近コミット（最大 10 件）
  recentSummary?: string; // 直近作業の LLM サマリー（生成失敗時は無し）
  todoRepo?: string;      // payload.todos / todoSummaries 側のラベル（iOS の join 用）
  todoSummary?: string;   // 既存 todoSummaries から join
  todoCount: number;      // TODO.md の未完了件数（0 = TODO.md 無し）
}
```

- 一覧は **pushed_at 降順（更新順）**。対象はトークンで見える非 fork・非 archived リポジトリのうち
  **直近 90 日以内に push があったもの、最大 20 件**（コード内定数。env は増やさない）
- `todoRepo` を backend 側で解決して持たせる理由: todos コレクタのラベルはリモートが
  `owner/repo`・ローカルパスが basename で、一覧側の `owner/name` と一致しないことがある。
  join（完全一致 → name 部分一致の順）は backend で 1 回だけ行い、iOS は `todoRepo` で
  `payload.todos` を引くだけにする

### Phase 1: backend コレクタ — 更新順リポジトリ一覧 + 直近コミット

- `collectors/github.ts`
  - `/user/repos?sort=pushed&direction=desc` から `pushed_at` / `html_url` も取るよう
    `GhRepo` を拡張（既存 `listAccessibleRepos` の呼び出し元 todos.ts は互換維持）
  - 新関数 `collectRepoOverviews(now)`: 上記の絞り込み（90 日 / 20 件）後、各リポジトリの
    `/repos/{full_name}/commits?per_page=10` で直近コミットを取得。
    空リポジトリの HTTP 409 は `commits: []` として正常扱い
- `types.ts`: `RepoCommit` / `RepoOverview` を追加、`CollectedInput.repoOverviews?` と
  `BriefingPayload.repos?` を追加
- `collectors/all.ts`: repoOverviews の収集を組み込む（失敗は warning 化して全体を止めない）。
  `runBriefing.ts` の `collectorRunsFrom` に source `github_repos` を追加
- `collectors/check.ts`: リポジトリ一覧（repo / pushedAt / コミット件数）の出力を追加

API 呼び出し回数は毎朝 `/user/repos` 1〜2 回 + commits 最大 20 回で、レート制限上は問題ない。

### Phase 2: backend LLM — 直近作業サマリー + キャッシュ

`todoSummary.ts` / `todo_summary_cache` と同じパターンで実装する。

- `llm/repoSummary.ts`（新規): 直近コミットの message + date 一覧から
  「直近何の作業をしていたか」の 1〜2 文の日本語サマリーを生成。
  出力は json_schema 固定、`PROMPT_VERSION` 持ち
- キャッシュ: `db/schema.sql` に `repo_summary_cache`（todo_summary_cache と同型)を追加し、
  `db/repo.ts` に get/save（30 日で掃除）を追加。
  hash = sha256(プロンプト版数 + モデル ID + repo + コミット message/date 一覧)。
  push が無かったリポジトリは翌朝キャッシュヒットし LLM を呼ばない
  （初回 ~20 呼び出し、以降は前日に動いたリポジトリ分のみ）
- `jobs/runBriefing.ts`: `resolveTodoSummaries` と同型の `resolveRepoSummaries` を追加。
  生成失敗はそのリポジトリの `recentSummary` 無しで続行（iOS はコミット一覧のみ表示）。
  usage は `purpose=repo_summary` で記録。
  最後に todoSummaries / todos と join して `payload.repos` を組み立てる
  （`todoRepo` / `todoSummary` / `todoCount` を埋める）
- `llm/check.ts`: `--fixture` に repoSummary の検証を追加

コミットが 0 件のリポジトリ（90 日以内に push はあるが commits API が空を返すケース）は
サマリー生成をスキップする。

### Phase 3: iOS — GitHub タブをリポジトリ一覧に刷新

- `Models.swift`: `BriefingPayload.repos`・`RepoOverview`・`RepoCommit` を追加（backend と 1:1）
- `GitHubTabView.swift`: `payload.repos` があればリポジトリ一覧表示に切り替え
  - 行: リポジトリ名 + 相対更新時刻（「3日前」等）+ TODO 件数ピル、
    直近作業サマリー（1〜2 行）、TODO サマリー（無ければ件数のみ）
  - 並びは `pushedAt` 降順（backend で整列済みだが iOS でも再ソートして保険）
  - `NavigationLink` で詳細画面へ
- **旧 payload フォールバック**: `payload.repos == nil`（刷新前に生成されたブリーフィング）の間は
  既存の 2 セクション表示をそのまま使う（既存コードをフォールバックとして残す）

### Phase 4: iOS — リポジトリ詳細画面

- `Views/RepoDetailView.swift`（新規）。`RepoOverview` を受け取り表示:
  - ヘッダ: リポジトリ名・更新時刻・GitHub へのリンク（Safari で開く）
  - 「直近の作業」: recentSummary + コミット一覧（message / 日付 / リンク）
  - 「TODO」: todoSummary + `payload.todos` を `todoRepo` で絞った全タスク一覧
  - 「昨日の活動」: `payload.github` を repo で絞った commits/PR（空なら非表示）
- `.xcodeproj` は XcodeGen 生成物なので `xcodegen generate` で新ファイルを取り込む

### Phase 5: 実機確認・後片付け

- 一時 DB で `npm run briefing` を 2 回実行し、2 回目は repo_summary の LLM 呼び出しが
  キャッシュで 0 になることを確認
- `./run-ios-device.sh` で実機確認（一覧の並び・サマリー表示・詳細画面・旧 payload フォールバック）
- `docs/specs/ios-app-screens.md` の GitHub タブ記述を更新
- TODO.md → DONE.md 移動、本プランを `docs/plans/archive/` へ

## 影響範囲

- backend: `types.ts` / `collectors/github.ts` / `collectors/all.ts` / `collectors/check.ts` /
  `llm/repoSummary.ts`（新規)/ `llm/check.ts` / `db/schema.sql` / `db/repo.ts` /
  `jobs/runBriefing.ts`
- ios: `Models.swift` / `Views/GitHubTabView.swift` / `Views/RepoDetailView.swift`（新規）
- docs: `docs/specs/ios-app-screens.md`
- 既存 API・DB の破壊的変更なし（payload への追加フィールドとキャッシュテーブル追加のみ。
  旧アプリは未知フィールドを無視して動く）

## 既知の制約

- 一覧は GitHub リポジトリ基準。GITHUB_REPOS にローカルパスのみで指定した対象が
  GitHub 側の一覧に無い場合、その TODO はタブの一覧行としては出ない（HOME には従来通り出る）
- `pushed_at` は自分以外の push も含む（コラボリポジトリでは他人の更新でも上位に来る）
- データは朝のブリーフィング時点のスナップショット（リアルタイムではない）。手動更新は
  管理画面の run-briefing で可能

## テスト方針

- `npm run typecheck`
- `npm run collectors:check` — 実データでリポジトリ一覧・pushed_at・コミット取得を確認
- `npm run llm:check -- --fixture` — repoSummary の生成・スキーマ検証
- 一時 DB での briefing 2 回実行によるキャッシュ検証（todo_summary のときと同じ手法）
- iOS シミュレータビルド（`xcodebuild ... CODE_SIGNING_ALLOWED=NO`）+ 実機で表示確認
