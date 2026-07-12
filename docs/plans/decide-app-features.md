# アプリの機能を決める（調査プラン）

## 目的・背景

パーソナル秘書アプリ（ai-secretary）で何を作るかを決めるため、ユーザー（Akira Kozakai）の日常で扱う情報源を調査し、機能アイデアを洗い出す。

## 対応方針

以下の Step で情報源を把握したうえで、機能アイデアをまとめる。

- Step 1: Google カレンダーの把握 — MCP 連携でカレンダーの内容・使い方を確認する
- Step 2: Gmail の把握 — MCP 連携でメールの種類・量・定常的に来るもの（通知系など）を確認する
- Step 3: GitHub の作業リポジトリの把握 — `gh` CLI で所有リポジトリ・活動状況を確認する
- Step 4: ESL 学校の Canvas の把握 — Canvas LMS の URL・通知メール（Gmail 内）などから、どんな情報が取れるかを確認する（API トークンの有無も確認）
- Step 5: アイデア出し — Step 1〜4 の結果を踏まえ、機能候補を優先度付きでまとめる

## 成果物

- 調査結果とアイデアを `docs/specs/app-features.md`（または本ファイル追記）にまとめる
- 決まった機能を TODO.md に落とし込む

## 影響範囲

コード変更なし（調査のみ）。ドキュメントの追加のみ。

## テスト方針

調査タスクのためテストなし。各情報源に実際にアクセスできたことを確認する。

## 調査結果

### Step 3: GitHub の作業リポジトリ（2026-07-12 調査済み、プライベート含む）

GitHub ユーザー: `akiraak`。全 90 リポジトリ（公開 + プライベート）。`gh` CLI 認証済み（scope: repo）。

直近 3 ヶ月でアクティブなリポジトリ:

| リポジトリ | 可視性 | 内容 | 最終 push |
|---|---|---|---|
| g3plus-ops | private | 自宅サーバ g3plus（Ubuntu, Intel N150）の構成管理・運用。n8n.chobi.me / wiki.chobi.me などを運用 | 2026-07-12 |
| kitchen-living | private | キッチン向けアプリ（在庫・買物リスト・レシピ・カレンダー）。React Native + Unity (UaaL) | 2026-07-12 |
| esl-learning-assistant | public | AI ESL 学習アシスタント（Swift/iOS） | 2026-07-12 |
| ai-secretary | public | 本プロジェクト | 2026-07-12 |
| esl-text-audio | public | ESL 教材生成。esltext.chobi.me で公開（g3plus で自動デプロイ） | 2026-07-11 |
| claude-code-manager | public | 複数 Claude Code CLI の管理（TypeScript） | 2026-06-26 |
| vibeboard | public | バイブコーディング用管理画面 | 2026-06-21 |
| ai-mentors | private | 詳細不明（README 未整備、Shell） | 2026-06-20 |
| deep-pulse | public | TypeScript（説明なし） | 2026-06-11 |
| nemoclaw-manager | private | 詳細不明（README なし） | 2026-05-27 |
| minecraft-manager | private | Windows 側 Minecraft Bedrock の MOD 管理（WSL から操作） | 2026-04-21 |

傾向:

- AI を使った個人プロジェクトを常時 4〜6 本並行開発。現在の中心は **ESL 学習関連**（esl-learning-assistant, esl-text-audio）と **kitchen-living**
- **自宅サーバ g3plus（chobi.me ドメイン）** が個人インフラのハブ。n8n（ワークフロー自動化）と Wiki.js が稼働しており、秘書アプリの通知・定期実行の連携先候補になる
- 過去プロジェクトから、音声合成・翻訳・動画生成・Twitch 連携などの資産が多い

### Step 1: Google カレンダー（ブロック中）

claude.ai MCP コネクタの認証が必要。ユーザーが `/mcp` で「claude.ai Google Calendar」を認証すればツールが使えるようになる。

### Step 2: Gmail（ブロック中）

同上。`/mcp` で「claude.ai Gmail」の認証が必要。

### Step 4: ESL 学校の Canvas（要ユーザー情報）

Canvas LMS の一般的なデータ取得手段（インスタンス URL が分かれば利用可能）:

- **REST API**: ユーザー自身が Canvas の Account > Settings から Access Token を発行できる。コース・課題（締切）・アナウンス・成績・カレンダーイベント・受信箱などが取得可能
- **iCal フィード**: Canvas のカレンダー（課題締切含む）は認証不要の秘密 URL で iCal 購読できる
- **通知メール**: Canvas からの通知メールを Gmail 側で把握する方法もある（Gmail 認証後に確認可能）

ユーザーに確認が必要: 学校の Canvas インスタンス URL、Access Token を発行できるか。

## アイデア出し（暫定・調査完了後に更新）

パーソナル秘書アプリの機能候補:

1. **朝のブリーフィング**: 今日の予定（Google カレンダー）+ Canvas の課題締切 + 未読の重要メールを毎朝まとめて通知
2. **Canvas 課題トラッカー**: 課題・締切・アナウンスを取得して一覧化、締切前リマインド
3. **メールの要約・トリアージ**: Gmail を定期チェックし、対応が必要なメールだけ抽出・要約
4. **GitHub 活動ダッシュボード**: 並行プロジェクトの最終更新・放置中の TODO を横断把握
5. **予定と課題の統合カレンダー**: カレンダー + Canvas 締切 + 自分のタスクを一画面に統合
6. **ESL 学習サポート連携**: esl-learning-assistant / esl-text-audio と連動し、授業前の予習リマインドや教材提示

優先度・実現形態（Web / CLI / 通知ボット）は Gmail・カレンダー・Canvas の実データを見てから決める。
