# ~/ 配下の他プロジェクト管理: ai-secretary で持つか、別プロジェクトにするか（調査）

## 目的・背景

`~/` には多数のプロジェクトがあり、それらを横断して管理したい。その役割を
ai-secretary に持たせるか、新しく別プロジェクトとして作るかを判断する材料を揃える。

## 現状調査（2026-10-03、sx360 上で実施）

### ~/ のプロジェクト

- git リポジトリ 47 件（`~/` 直下のディレクトリは 73 件）
- 直近 30 日にコミットがあるのは 9 件（ai-income-lab / ai-secretary / auto-phone / daily-note / deco-tarm / g3plus-ops / pc-manager / teba-bot / vibeboard）
- vibeboard を vendor 済み 22 件、CLAUDE.md あり 32 件、未完了 TODO があるもの 22 件
- **GitHub remote が無いもの 3 件**: teba-bot（TODO 17 件）/ SCC-2026-summer / ssh-to-titan
- PC は sx360・titan の 2 台（pc-manager）。プロジェクトがどちらにあるかは PC ごとに違いうる

### ai-secretary が既に持っている「横断」機能

- `GITHUB_REPOS=*` で、トークンから見える全リポジトリの TODO.md（未完了の `- [ ]`）と昨日の活動を毎朝収集している
- LLM でリポジトリごとの直近作業サマリー・TODO サマリーを作り、iOS の GitHub タブと管理画面の GitHub ページに表示する
- `POST /todos/repo` で、アプリから任意リポジトリの TODO.md にタスクを追加コミットできる
- ただし動いているのは **g3plus（Cloudflare 経由で公開されたサーバ）** で、データ源は GitHub API だけ。
  ローカルにしか無い状態（未 push・未コミット・remote 無しのリポジトリ・稼働中の Claude Code セッション・vibeboard）は見えない

### 隣接する既存プロジェクト

- **claude-code-manager**: ローカルで動く複数 Claude Code CLI のダッシュボード（`~/.claude/projects/` の jsonl と `/proc` を読む）。vibeboard + ai-monitor プラグイン構成。最終コミットは 2026-06-30
- **vibeboard**: 1 プロジェクトにつき 1 つのローカル管理画面。Tasks タブから Claude Code セッションへタスクを投函できる
- **pc-manager**: PC 自体（Windows / WSL）の管理

## 「管理」の中身による切り分け

| 種類 | 例 | 必要な実行場所 | 向いている置き場 |
|---|---|---|---|
| ① 俯瞰 | 全プロジェクトの TODO・活動・停滞の一覧、朝の要約、スマホから見る | どこでも（GitHub API で足りる） | **ai-secretary**（既に大半がある） |
| ② 操作 | 横断のタスク投入、Claude Code セッションへの実行依頼、vibeboard の横断表示 | **ローカル PC 必須** | 別プロジェクト or claude-code-manager |
| ③ 保守 | vibeboard の一括 update、未 push・未コミットの検出、CLAUDE.md 規約の統一、依存の更新 | **ローカル PC 必須** | 別プロジェクト or claude-code-manager |

## 比較

### A. ai-secretary で管理する

- 良い点: ①はほぼ実装済みで追加コストが最小。iOS・push・LLM 要約・管理画面の基盤を流用できる
- 悪い点:
  - ②③はサーバ（g3plus）から実行できない。ローカルにエージェントを置き、サーバへ送らせる仕組みが別に必要になる
  - 公開サーバに「ローカルのリポジトリを操作する権限」を持たせることになり、攻撃されたときの被害が大きくなる（今は TODO.md へのコミットだけに絞っている）
  - 「秘書（朝のブリーフィング）」というプロジェクトの性格が広がりすぎる。管理画面は既に 8 ページある

### B. 新しく別プロジェクトを作る

- 良い点: ローカル専用（127.0.0.1）で②③を安全に作れる。ai-secretary のデプロイや規約と切り離せる
- 悪い点: ①の収集・要約を二重に作りがち。プロジェクトがさらに 1 つ増える。claude-code-manager と役割がかぶる

### C. claude-code-manager を拡張する（第 3 案）

- 良い点: 「ローカルの複数 Claude Code / 複数プロジェクトを 1 画面で扱う」という性格がそのまま②に合う。vibeboard の customTabs 基盤もある
- 悪い点: 今のスコープ（CLI の稼働監視）からは広がる。3 か月止まっているので、作り直す前提になるかもしれない

## 結論（推奨）

**新しく作るなら「ローカル側の操作・保守」だけに絞り、俯瞰は ai-secretary に寄せたまま 2 層に分ける。**

- ①俯瞰 → **ai-secretary を拡張する**（例: 停滞プロジェクトの検出、TODO の横断ビュー、remote 無しリポジトリの扱い）
- ②③操作・保守 → **ai-secretary には入れない**。claude-code-manager の拡張を第一候補とし、性格が合わなければ新規プロジェクトにする
- 2 つの間は「ローカル側が状態のスナップショット（未 push・未コミット・稼働セッション・remote 無しの TODO）を
  ai-secretary の API へ送る」一方通行だけでつなぐ。ai-secretary からローカルを操作する経路は作らない

## 次に決めること

- 「管理」で一番欲しいのは①②③のどれか（これで A / B / C の比重が決まる）
- 対象は sx360 だけか、titan も含むか（ローカル側のエージェントを両 PC に置くかどうか）

## 影響範囲・テスト方針

調査のみ。コード変更なし。方針が決まった時点で、実装プランを別ファイルで作る。
