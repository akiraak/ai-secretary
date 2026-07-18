# HOME の GitHub 機能を削除

## 目的・背景

HOME（統合フィード）には GitHub 系のセクションが 2 つある。

1. 「GitHub」 — 各リポジトリ TODO.md の LLM サマリー（タグ + 件数 + 1〜2 文）
2. 「昨日の GitHub」 — 昨日の commits / PR のリポジトリ別集計

GitHub タブが更新順リポジトリ一覧 + 詳細画面に拡充され（2026-07-17）、HOME 側は重複情報になったため
両セクションを削除する（TODO: 「home の機能のgithub を削除」）。

## 対応方針

iOS の表示のみ削除する。backend の収集・payload（`todos` / `todoSummaries` / `github` / `repos`）・
ブリーフィング本文は変更しない。GitHub タブは payload を引き続き使用する。

- `ios/AISecretary/Views/HomeView.swift`
  - `sections(_:)` から「GitHub」「昨日の GitHub」の SectionCard を削除
  - 未使用になる private ヘルパー `todoRepoSummaries` / `githubSummary` を削除
  - 冒頭コメントのセクション構成説明を更新
- `docs/specs/ios-app-screens.md` — HOME のセクション一覧から GitHub 系 2 項目を削除し、
  GitHub タブへ移行済みである旨を追記
- `Components.swift` の `RepoTag` は GitHub タブ / リポジトリ詳細で使用中のため残す
- `Models.swift` は backend `types.ts` と 1:1 のため変更しない

## 影響範囲

iOS の HOME 表示と仕様書のみ。payload 構造・backend・push・GitHub タブは不変。

## テスト方針

`xcodegen generate` 後、iPhone 17 シミュレータ向け `xcodebuild` が通ることを確認する。
