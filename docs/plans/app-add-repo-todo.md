# アプリからリポジトリの TODO.md へタスクを追加

## 目的・背景

各リポジトリの `TODO.md` は todos コレクタが毎朝読んでブリーフィング / GitHub タブに表示しているが、
書き込みは手元で編集してコミットするしかない。外出先で思いついたプロジェクトタスクを
iOS アプリからそのリポジトリの `TODO.md` に直接追加できるようにする。

日々の雑務タスク(リポジトリに紐づかないもの)は別プラン
[daily-todos.md](daily-todos.md) が backend DB に保存する。本プランは「プロジェクトのタスクを
正本である `TODO.md` に書き戻す」経路で、両者は独立して実装できる。

## 対応方針

### backend: `POST /todos/repo`(iOS 用 Bearer 必須帯)

リクエスト: `{repo: "owner/name", text: "タスク内容"}`

バリデーション:

- `repo` は `^[\w.-]+/[\w.-]+$` 形式、かつ**最新ブリーフィング payload の `repos` 一覧
  (無ければ `GITHUB_REPOS` の明示エントリ)に含まれること**。
  トークンで見える任意のリポジトリへ書けてしまうのを防ぐ(共有シークレット漏洩時の被害限定)
- `text` は 1〜200 文字・改行不可。Markdown リンク等はそのまま 1 行として扱う
- `GITHUB_REPOS` のローカルパスエントリは対象外(MVP はリモート `owner/repo` のみ。
  ローカルパスは g3plus 上の作業ツリーで git 管理と衝突しやすいため)

書き込み処理(`src/collectors/github.ts` に `ghApi` と並べて実装 or `src/github-write.ts` 新設):

1. `GET /repos/{repo}/contents/TODO.md`(JSON Accept)で `content`(base64)と `sha` を取得
2. 挿入位置: 最後のトップレベル `- [ ]` / `- [x]` 行の直後に `- [ ] <text>` を挿入。
   チェックボックス行が 1 つも無ければ末尾に追記(末尾改行を整える)
3. `PUT /repos/{repo}/contents/TODO.md` で `{message, content(base64), sha}` をコミット。
   コミットメッセージ: `TODO 追加: <text>`
4. sha 衝突(409/422)は再取得して 1 回だけリトライ。それでも失敗なら 502 で理由を返す
5. `TODO.md` が無い(404)場合は `# TODO\n\n- [ ] <text>\n` で新規作成(sha なし PUT)

レスポンス: `{ok: true, repo, text, url}`(url = コミットの html_url。失敗時は 4xx/502 + 理由)。

**運用上の注意(要ドキュメント反映)**: 現行の `GITHUB_TOKEN` は読み取りだけで足りていたが、
本機能には対象リポジトリへの **Contents: Read and write** 権限が必要。
`.env.example` のコメントと `docs/specs/deploy-g3plus.md` に明記する。
トークンに書き込み権限が無い場合は 403 をそのまま「トークンに書き込み権限がありません」として返す。

### iOS

追加導線は `RepoDetailView`(リポジトリ詳細)の「TODO」セクション末尾に常設の入力行として置く。
対象リポジトリが画面コンテキストで確定しているためリポジトリ選択 UI が不要で、
GitHub タブの一覧行は NavigationLink なのでボタンを置くとタップ領域が競合する。

- 入力行 = `plus.circle` アイコン + `TextField("タスクを追加…")` + 送信ボタン(`arrow.up.circle.fill`)。
  空文字は送信無効。キーボードの submit でも送信。折りたたみトグルの下に置き常に見える位置にする
- 送信中は送信ボタンを ProgressView に差し替え。成功で入力欄をクリアし一覧末尾に楽観追加
  (todos は payload join 由来なので `@State` のローカル追加分配列を持ち表示時に連結。
  payload の正本反映は翌朝のブリーフィング)
- 失敗はアラートで理由表示(権限不足 403 / 対象外リポジトリ 400 など)
- **TODO セクションは常時表示に変更する**: 現状は todoSummary / todos が無いと非表示だが、
  追加 API は TODO.md を新規作成できるため、空のときも空表示 + 入力行を出す
- `BackendClient` に `addRepoTodo(repo:text:)` を追加
- ナビバー「+」→ シート方式は不採用(1 行の追加にはシートが重く、TODO 一覧のそばの方が発見しやすい)

### 管理画面(任意・後続)

GitHub ページの各リポジトリ行に追加フォームを置ける(`POST /admin/todos/repo` をハンドラ共用で新設)。
MVP では見送り、必要になったら足す。

## 影響範囲

- backend: `server.ts`(ルート追加)/ `collectors/github.ts` or 新規モジュール(contents PUT)/
  `.env.example` / `docs/specs/deploy-g3plus.md`
- iOS: `BackendClient.swift` / `Views/RepoDetailView.swift`
- DB・コレクタ・LLM 層・管理画面・既存 API は不変
- 書き込んだタスクは翌朝の todos コレクタが通常経路で拾う(コレクタ側の変更は不要)

## Phase 分割

- Phase 1: backend — contents 取得/挿入/PUT のモジュール + `POST /todos/repo`(検証・リトライ・エラー変換込み)
- Phase 2: iOS — `RepoDetailView` の追加 UI + `BackendClient`
- Phase 3: ドキュメント — `.env.example` / deploy-g3plus.md にトークン権限を明記

## テスト方針

- `npm run typecheck`
- 挿入ロジック(文字列 → 文字列)は純関数に切り出し、`diff:check` 同様の単体 check スクリプトで検証
  (チェックボックス行あり/なし/末尾改行なし/`- [x]` のみ、の各ケース)
- テスト用のプライベートリポジトリ(または本リポジトリ)に対して curl で実際に 1 件追加し、
  GitHub 上のコミットと `TODO.md` 差分を確認 → 追加した行は手で戻す
- 認証境界: Bearer なし 401、対象外リポジトリ 400、書き込み権限なしトークンで 403 系の文言確認
- iOS: シミュレータビルド + ローカル API サーバ経由で RepoDetailView から追加 → 楽観反映と
  エラーアラート(サーバ停止時)をスクリーンショット確認
