# HOME「GitHub」セクションを 5 件のみ表示 + 折りたたみ

## 目的・背景

HOME の「GitHub」セクションはリポジトリごとの TODO サマリー（タグ + 件数 + LLM サマリー）を
全リポジトリ分表示しており、リポジトリが多いと HOME が縦に長くなる。
5 件のみ表示し、6 件目以降は折りたたむ（TODO: 「home のgithubを5件のみにしてあとは折りたたむ」）。

## 対応方針

リポジトリ詳細（`RepoDetailView`）で実装済みの折りたたみパターン
（`collapseLimit` + 「残り N 件を表示」/「折りたたむ」トグル）を HOME に踏襲する。

- `ios/AISecretary/Views/HomeView.swift`
  - `todoRepoSummaries` のリポジトリ一覧を先頭 5 件のみ表示（並びは従来どおり todos の初出順）
  - 6 件目以降は「残り N 件を表示」トグルで展開、展開後は「折りたたむ」で戻せる
  - `@State showAllGithubRepos` + `collapseLimit = 5` を追加（RepoDetailView と同じ見た目のトグル）
- backend・payload・他画面は変更しない

## 影響範囲

iOS の HOME「GitHub」セクションの表示のみ。

## テスト方針

`xcodegen generate` 後、iPhone 17 シミュレータ向け `xcodebuild` が通ることを確認する。
