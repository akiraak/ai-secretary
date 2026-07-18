# HOME の「昨日の GitHub」セクションを削除

## 目的・背景

HOME（統合フィード）の「昨日の GitHub」（昨日の commits / PR のリポジトリ別集計）は、
GitHub タブの拡充（更新順リポジトリ一覧 + 詳細画面、2026-07-17）により重複情報になったため削除する
（TODO: 「home の昨日のgithub を削除」）。

「GitHub」セクション（各リポジトリ TODO.md の LLM サマリー）は HOME に残す。

> 注: 当初「GitHub」セクションも含めて両方削除したが指示の取り違えで、
> 「昨日の GitHub」のみ削除が正だったため「GitHub」セクションは復元した。

## 対応方針

iOS の表示のみ削除する。backend の収集・payload（`github` / `repos` ほか）・ブリーフィング本文は
変更しない。GitHub タブは payload を引き続き使用する。

- `ios/AISecretary/Views/HomeView.swift`
  - `sections(_:)` から「昨日の GitHub」の SectionCard を削除
  - 未使用になる private ヘルパー `githubSummary` を削除
  - 冒頭コメントのセクション構成説明を更新
- `docs/specs/ios-app-screens.md` — HOME のセクション一覧から「昨日の GitHub」を削除し、
  GitHub タブへ移行済みである旨を追記
- `Components.swift` の `RepoTag` は HOME「GitHub」/ GitHub タブで使用中のため残す
- `Models.swift` は backend `types.ts` と 1:1 のため変更しない

## 影響範囲

iOS の HOME 表示と仕様書のみ。payload 構造・backend・push・GitHub タブは不変。

## テスト方針

`xcodegen generate` 後、iPhone 17 シミュレータ向け `xcodebuild` が通ることを確認する。
