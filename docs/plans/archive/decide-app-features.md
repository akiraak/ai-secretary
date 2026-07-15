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

### Step 1: Google カレンダー（2026-07-12 調査済み、MCP 認証済み）

カレンダーは 6 つ。タイムゾーンは America/Los_Angeles（シアトル在住）。

| カレンダー | 状態 | 内容 |
|---|---|---|
| akira（akiraak@gmail.com、メイン） | 稼働中 | 通院（Kaiser Permanente: 消化器科・エコー検査・歯医者 8/10）、Shoreline 学期日程（夏学期 7/1 開始、学生証発行 7/13〜15）、毎月 25 日の「雑誌購入」定期イベント |
| cessna | 2026-03 まで活動 | パートナー（ento.entotto@gmail.com）との共有。用事・通院・漫画発売日（隔週）・ボランティア等。作成者はほぼ ento 側 |
| Family / WE:Topic | 直近 1 年イベントなし | 実質未使用 |
| 日本の祝日 / アメリカの祝日 | 購読 | — |

使い方の特徴:

- **予定は少ない**（メインで 2.5 ヶ月に 9 件程度）が、医療・学校などクリティカルなものが中心 → 直前リマインドと朝ブリーフィングの価値が高い
- リマインダーはメール通知（前日 900〜1440 分前）を使う習慣がある
- 通院予定にはパートナーを招待し Google Meet を付ける運用
- イベント密度が低いので、秘書からの「カレンダーへの逆書き込み」も邪魔になりにくい

### Step 2: Gmail（2026-07-12 調査済み、MCP 認証済み）

**外部からの受信は週 20 通程度で、ほぼすべて機械的な通知・ニュースレター。人間からの個人メールはほぼゼロ。**

受信メールの分類（直近 7 日のサンプル）:

- 学校: Canvas 通知（notifications@instructure.com）、Shoreline 事務局（navigate@shoreline.edu）
- 購買: Amazon US の配送・プロモ（`akiraak+us@gmail.com` エイリアスで分離済み）
- 金融: 三井住友銀行の定期通知（日本の口座を維持）
- サブスク・アカウント: Google セキュリティ通知、Google One 期限切れ予告（**7/19 終了 — 要対応の実例**）、NordVPN プロモ、GitHub 認証コード
- ニュースレター: NYT（breaking/editor picks）、Mackerel、note.com

最大の特徴は **自分宛て送信メールが 90 日で約 200 スレッド** あること。g3plus 上の自動化（Autopilot = n8n）が毎日配信している:

- 「AIニュース」（毎日 07:00 PT）、「発電ニュース（核融合）」（07:15）、「シアトルニュース」（07:30、ento にも送信）、「[Autopilot] Daily Report」（ジョブ稼働報告、09:00）
- ほかに手動のセルフメモ（「病院の支払い」等）や ESL 教材の英日ペア自己送信

示唆:

- メールトリアージの主対象は「人間からのメール」ではなく **通知の山からアクショナブルなもの（サブスク期限・配送・学校・銀行）を拾う** こと
- Gmail は既に自動配信で混んでいるため、秘書の通知チャネルをメールにすると埋もれるリスクが高い
- ニュースダイジェストを自分宛てメールで受ける習慣が既にある = 「毎朝まとめが届く」体験は受け入れられている。朝ブリーフィングは Autopilot の路線の延長として自然

### Step 4: ESL 学校の Canvas（2026-07-12 調査済み、Gmail 経由で特定）

- インスタンス: **`https://shoreline.instructure.com`**（Shoreline Community College）。2022〜2025 は CCSF（City College of San Francisco、akozakai@mail.ccsf.edu）で、2026 春から Shoreline に移った
- 現在のコース: `ESLC40/ESLAF63/ESLCE43 - HY - SU26 - ESL/ELL for College and Career 4 & ESLAF 063`（course id 2742290、夏学期 7/1〜）。課題例: 「2.7 TAKE: Book Review of "Blink" - Listening Quiz」
- **通知メールは 30 日で 2 通のみ**（採点通知と学校アナウンス）。課題の作成・締切はメールに流れてこないため、**メールだけでは締切把握は不可能**
- → 締切データには API か iCal が必要。**REST API の Access Token は Shoreline の管理者が学生の発行を無効化しており使用不可**（2026-07 確認済み）。→ **iCal フィードに確定**（認証不要、締切・カレンダーイベントを取得可）
- 残るユーザー作業: Canvas → Calendar → 右下「Calendar Feed」の `.ics` URL 取得

## アイデア出し

詳細版は [docs/specs/app-features.md](../specs/app-features.md) にまとめた（2026-07-12、管理するもの × インターフェース × 優先度。実データ調査を反映済み）。以下は初期メモ。

パーソナル秘書アプリの機能候補:

1. **朝のブリーフィング**: 今日の予定（Google カレンダー）+ Canvas の課題締切 + 未読の重要メールを毎朝まとめて通知
2. **Canvas 課題トラッカー**: 課題・締切・アナウンスを取得して一覧化、締切前リマインド
3. **メールの要約・トリアージ**: Gmail を定期チェックし、対応が必要なメールだけ抽出・要約
4. **GitHub 活動ダッシュボード**: 並行プロジェクトの最終更新・放置中の TODO を横断把握
5. **予定と課題の統合カレンダー**: カレンダー + Canvas 締切 + 自分のタスクを一画面に統合
6. **ESL 学習サポート連携**: esl-learning-assistant / esl-text-audio と連動し、授業前の予習リマインドや教材提示

優先度・実現形態（Web / CLI / 通知ボット）は Gmail・カレンダー・Canvas の実データを見てから決める。

### 実現形態の決定（2026-07）

通知チャネルは **MVP から ネイティブ iOS アプリ + 自前 APNs** で行くとユーザーが決定。
検証（[spec 2-2-1](../specs/app-features.md)）では「通知の配送だけならオーバーキル」だが、
UX（ウィジェット / Live Activities / アプリ内ダッシュボード）とプライバシー（医療情報を自インフラに閉じる）を
初日から取りに行く方針。ユーザーが iOS 開発者（Swift 資産あり）である点も後押し。
Discord / Pushover 等のつなぎチャネルは採用しない。
