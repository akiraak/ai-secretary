# GITHUB_REPOS の自動発見（`*` で全リポジトリ監視）

作成日: 2026-07-15
親タスク: [MVP: 朝ブリーフィング](mvp-morning-briefing.md) の拡張

## 目的・背景

ユーザー要望: 「取得できる全てのリポジトリの監視をしたい。TODO.md がないものも含めて」。

- GitHub 活動（commits / PR）は Events API がユーザー単位なので **既に全リポジトリ対象**。
- `GITHUB_REPOS` が効くのは **TODO.md の読み取り対象のみ**。現状は手書きリスト。
  リポジトリは 102 件あり手動管理は現実的でない。

## 対応方針

`GITHUB_REPOS` に特別値 **`*`** を導入し、トークンで見える全リポジトリを自動列挙して
TODO.md を読む。無いリポジトリ（404）は正常系として黙ってスキップ。

- `src/collectors/github.ts`
  - `GhHttpError`（status 付きエラー）を導入し `ghApi` / `ghApiRaw` が投げる
  - `listAccessibleRepos(token)`: `GET /user/repos?per_page=100&sort=pushed` をページング
    （上限 10 頁 = 1000 件）。**fork と archived は除外**（upstream 由来 / 停止済みの
    TODO.md はノイズのため。監視したい fork は `*` と併記で明示指定できる）
- `src/collectors/todos.ts`
  - エントリ `*` を発見リポジトリ群に展開。明示エントリと重複する owner/repo は除外
  - 明示エントリ（ローカルパス / owner/repo）は従来どおり混在可・読めなければ警告
  - 自動発見リポジトリの 404 のみ警告なしスキップ。その他のエラーは従来どおり警告
  - 件数が ~100 になるため **並列 8 本**で contents を取得（レート制限 5000/h に対し
    1 実行 ~100 リクエストで問題なし）
- `.env.example`: `*` の説明を追記。ユーザーの `.env` は `GITHUB_REPOS=*` に変更

## 影響範囲

backend の GitHub / TODO コレクタのみ。DB スキーマ・API・iOS アプリ・LLM 層は変更なし
（TodoItem の形は不変。件数が増えるためブリーフィングの TODO セクションが長くなる可能性
はあるが、リポジトリごと上限 10 件の既存ガードで抑制）。

## テスト方針

- `npm run typecheck`
- `npm run collectors:check` ライブ実行: `*` で 90+ リポジトリから TODO.md 保有分のみ
  取得され、404 の警告が出ないこと・実行時間が現実的（数秒〜十数秒）なこと
- 明示エントリ併記（ローカルパス + `*`）の重複除外を確認
