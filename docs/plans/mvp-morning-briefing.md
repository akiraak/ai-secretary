# MVP: 朝ブリーフィングを iOS アプリに push（実装プラン）

作成日: 2026-07-14
親タスク: [アプリの機能を決める](decide-app-features.md) / [spec](../specs/app-features.md)

## 目的・背景

パーソナル秘書アプリの MVP。毎朝 1 通、その日の予定・要対応メール・Canvas 締切をまとめて
**自前 APNs 経由でネイティブ iOS アプリに push** する。通知チャネルをネイティブ iOS アプリに
する方針はユーザー決定済み（[検証 2-2-1](../specs/app-features.md)）。

確定した前提（2026-07 時点）:

- Apple Developer Program 加入済み
- push ペイロード方式: **v1 はフル内容を payload に載せる** → 後で「シグナルのみ + 本文取得」へ移行（Phase 4）
- Canvas は **iCal フィード**（Access Token は Shoreline が無効化済み）。URL は `.env` 作成時に貼り付け
- ブリーフィング: **日本語**、配信時刻は **シアトル時間（America/Los_Angeles）**。既定 07:00 PT（Autopilot 07:00–07:30 に合わせる。`.env` で変更可）

## 重要な設計上の注意（先に潰す論点）

**claude.ai の MCP コネクタ（Gmail / Calendar）は、この Claude Code セッション内でしか使えない。**
g3plus 上で常時稼働するバックエンドは、自前で Google API にアクセスする必要がある。

→ **Google Cloud プロジェクトを作り、Calendar API + Gmail API を有効化し、OAuth で
リフレッシュトークンを一度取得して `.env` に保存する**（単一ユーザー・オフラインアクセス）。
サービスアカウントは個人 Gmail に（ドメイン委任なしでは）アクセスできないため使わない。

## 対応方針・アーキテクチャ

```
[g3plus / cron 07:00 PT]
   └─ backend (TypeScript / Node)
        ├─ Collector: Google Calendar API（今日の予定・締切）
        ├─ Collector: Gmail API（要対応メールのトリアージ元）
        ├─ Collector: Canvas iCal フィード（.ics パース → 締切）
        ├─ Collector: GitHub（gh CLI / API: 昨日の commits・PR）★
        ├─ Collector: 各リポジトリの TODO.md 読み取り（今日やる/次の作業）★
        ├─ LLM 層: Claude API（claude-haiku-4-5）で要約・トリアージ・日本語整形
        ├─ Store: SQLite（生成したブリーフィングを保存 = アプリのプル元）
        └─ Sender: APNs（HTTP/2 + JWT / .p8）で iOS へ push
[iOS アプリ (Swift/SwiftUI)]  ← メイン画面は「案A 統合フィード」
   ├─ 起動時にリモート通知登録 → デバイストークンを backend に POST
   ├─ push 受信 → 通知表示
   └─ アプリ開いたら GET /briefings/latest でブリーフィング表示
       （締切 → 今日やる → 要対応 → 昨日のGitHub の優先順1画面。[画面設計](../specs/ios-app-screens.md)）
```

★ GitHub / TODO.md コレクタは元計画では Phase 5 だったが、[画面レイアウト決定](../specs/ios-app-screens.md)により
MVP のメイン画面に取り込むため前倒し。`TODO.md` の読み取り先リポジトリは設定で持つ（当面はアクティブな数本）。

技術スタック（ユーザーの既存資産に合わせる）:

- backend: **TypeScript / Node**（g3plus は n8n=Node が稼働。他プロジェクトも TS 中心）
- 定期実行: g3plus の **cron**（将来 n8n スケジュールへ寄せてもよい）
- データ: **SQLite**
- LLM: **Claude API `claude-haiku-4-5`**（$1/$5 per MTok。品質不足なら `claude-sonnet-5` に切替）
- APNs 送信: Node の HTTP/2 + JWT（`.p8` 認証キー）。ライブラリは実装時に選定（apns2 等）
- iOS: **Swift / SwiftUI**、TestFlight 配布（個人用）

### backend API エンドポイント（MVP）

単一ユーザーなので認証は共有シークレット（Bearer）で簡易に。

- `POST /devices` — デバイストークン登録（body: token, platform）
- `GET /briefings/latest` — 最新ブリーフィング JSON を返す（アプリのプル元）
- （内部）cron 起動のジョブが 収集 → 生成 → 保存 → push を実行

### `.env` に必要な設定（実装時に `.env.example` を作る）

```
ANTHROPIC_API_KEY=
LLM_MODEL=claude-haiku-4-5
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
CANVAS_ICAL_URL=            # ユーザーが貼り付け
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=
APNS_P8_PATH=              # or inline key
APNS_ENV=sandbox           # sandbox | production
BRIEFING_HOUR=7            # America/Los_Angeles
TZ=America/Los_Angeles
BRIEFING_LANG=ja
API_SHARED_SECRET=         # /devices, /briefings/latest の Bearer
```

`.env` と `.p8`・iCal URL・リフレッシュトークンは秘密。Git にコミットしない（`.gitignore` に追加）。

## トリアージ基準（LLM プロンプトに入れる初期ルール）

[spec 1-2](../specs/app-features.md) の実データ分析に基づく:

- 要対応: サブスク期限 / 銀行・支払い / 学校事務(navigate@shoreline.edu) / セキュリティ警告
- 参考（1 行）: Canvas 採点結果 / Amazon 配送
- 無視: プロモ・ニュースレター
- 除外: 自分宛て自動送信（Autopilot ニュース、[Autopilot] レポート、セルフメモ）

## Phase / Step

- [x] Step 1: バックエンド雛形（TS/Node プロジェクト、`.env.example`、`.gitignore`、SQLite スキーマ）
- [x] Step 2: Google OAuth 設定 + Calendar / Gmail コレクタ（今日の予定・受信の取得）
  - 実装: `googleapis` 導入、`src/auth/google.ts`（OAuth2 クライアント/API ファクトリ）、
    `src/auth/googleGetToken.ts`（`npm run google:auth` = リフレッシュトークン取得ループバック CLI）、
    `src/collectors/calendar.ts`・`src/collectors/gmail.ts`、`src/util/time.ts`（シアトル時間の日境界計算）、
    `src/collectors/check.ts`（`npm run collectors:check` = 実データ取得確認）
  - **要ユーザー検証**: Google Cloud で「デスクトップアプリ」種別 OAuth クライアント作成 →
    ID/SECRET を `.env` → `npm run google:auth` でトークン取得 → `npm run collectors:check` で実データ確認
    （コードは typecheck 済み・未設定時は案内メッセージを出す。ライブ検証はユーザーの認証情報が必要）
- [x] Step 3: Canvas iCal コレクタ（.ics パース → 締切抽出）
  - 実装: `src/util/ics.ts`（最小 .ics パーサ: 行折り返し・TEXT エスケープ・VALUE=DATE / UTC / TZID 対応、
    依存ライブラリなし）、`src/collectors/canvas.ts`（フィード取得 → 今日から `CANVAS_LOOKAHEAD_DAYS`
    (既定 7) 日以内の締切を抽出。SUMMARY「課題名 [コース名]」を title / course に分離）、
    `collectors:check` に Canvas セクション追加
  - フィクスチャ検証済み（折り返し・エスケープ・過去/先読み範囲外の除外・TZID 変換）。
    **ライブ検証は `.env` に CANVAS_ICAL_URL 投入後、`npm run collectors:check` で行う**
- [x] Step 3.5: GitHub コレクタ（昨日の commits/PR）+ 各リポジトリの TODO.md 読み取り
  - 実装: `src/collectors/github.ts`（Events API から PushEvent/PullRequestEvent を抽出。
    昨日(PT)窓でフィルタ、commit は sha で dedupe・`distinct=false` 除外、PR は
    作成/マージ/クローズ/再オープンのみ拾う。認証は `GITHUB_TOKEN` → `gh auth token` の順で解決
    —— この Mac に gh CLI が無いため「gh CLI 前提」から「API 直 fetch + トークンを gh から借りられる」方式に変更）、
    `src/collectors/todos.ts`（`GITHUB_REPOS` の各エントリから TODO.md を読む。
    `owner/repo` は GitHub API、`/` `.` `~` 始まりはローカルパス。トップレベルの `- [ ]` のみ抽出、
    リンクはラベルだけ残す、読めないリポジトリは警告してスキップ）、`collectors:check` に両セクション追加
  - フィクスチャ検証済み（窓フィルタ・dedupe・PR アクション別ラベル・時系列順・TODO 抽出規則）。
    ローカル TODO.md 読み取りは本リポジトリで実データ確認済み。
    **GitHub API のライブ検証は `.env` に GITHUB_TOKEN（または `gh auth login`）投入後、
    `npm run collectors:check` で行う**
- [x] Step 4: LLM 層（Claude Haiku 4.5 で収集結果を日本語ブリーフィングに整形・トリアージ）
  - 実装: `@anthropic-ai/sdk` 導入、`src/collectors/all.ts`（全コレクタを並列実行し
    `CollectedInput` に集約。失敗コレクタは warnings に落として空リストで続行）、
    `src/llm/briefing.ts`（`generateBriefing`: 構造化出力 `output_config.format` の
    JSON Schema で {title, summary, mails[]} を固定。トリアージ規則 spec 1-2 を
    システムプロンプトに埋め込み。メールは LLM に index だけ返させ、from/subject/
    gmailLink はコード側で候補から復元 = メタデータのハルシネーション防止）、
    `src/llm/check.ts`（`npm run llm:check` = 実データ、`-- --fixture` = 4 区分を
    網羅するサンプル入力で認証情報なしでも LLM 層だけ検証可能）
  - フィクスチャ検証済み（トリアージ復元の不正 index/重複/並べ替え、出力 JSON の
    パース・スキーマ検証、プロンプト整形の index 付与・日付のみ dueAt の素通し）。
    **ライブ検証は `.env` に ANTHROPIC_API_KEY 投入後、`npm run llm:check -- --fixture` で行う**
- [x] Step 5: API（POST /devices, GET /briefings/latest）+ SQLite 保存
  - 実装: `src/db/repo.ts`（devices upsert / briefings 挿入・最新取得 / collector_runs 記録。
    SQL をこのファイルに集約）、`src/server.ts`（node:http のみでフレームワークなし。
    Bearer 共有シークレットを timingSafeEqual で照合、ボディ 64KB 上限、
    token 1〜512 文字バリデーション。`API_SHARED_SECRET` 未設定なら起動拒否）、
    `src/jobs/runBriefing.ts`（`npm run briefing` = 収集 → collector_runs 記録 →
    LLM 生成 → briefings 保存。push は Step 6 でこの末尾に追加）、
    `src/index.ts` をサーバ起動エントリに変更（`npm run dev` / `npm start`）
  - ライブ検証済み（一時 DB + curl）: 401（認証なし/誤シークレット）、
    POST /devices の登録・同一トークン upsert（行は増えない）・400（token 不正/不正 JSON）、
    GET /briefings/latest の 404（未生成）→ 挿入後 200 で payload 復元、405/404、
    シークレット未設定時の起動拒否、認証情報なしでの `npm run briefing`
    （コレクタ警告を出しつつ collector_runs は記録、LLM で明示エラー終了）
- [x] Step 6: APNs 送信（.p8/JWT/HTTP2）でデバイスへ push
  - 実装: 外部ライブラリなし（apns2 等は使わず、ES256 JWT は node:crypto の
    `sign(..., dsaEncoding: 'ieee-p1363')`、送信は node:http2 —— 未確定だった「ライブラリ選定」はこれで確定）。
    `src/push/apns.ts`（APNS_* 検証 + .p8 読込 → プロバイダ JWT 生成 → 1 つの HTTP/2 接続で
    全デバイスへ alert push。410 Unregistered は gone フラグ、リクエスト 15 秒タイムアウト）、
    `src/push/briefingPush.ts`（payload 組み立て: aps.alert = title/summary + フル briefing。
    4KB 超過時はシグナルのみ briefingId/briefingDate に自動フォールバック —— どちらでもアプリは
    GET /briefings/latest で本文取得可。送信結果を push_log に記録、1 台以上成功で
    briefings.pushed_at 更新、410 のデバイスは devices から削除）、
    `src/jobs/runBriefing.ts` 末尾に push 追加（APNs 未設定・デバイス未登録は警告してスキップ、
    全デバイス送信失敗は exit 1 で cron 監視に引っ掛ける）、
    `src/push/check.ts`（`npm run apns:check` = 登録デバイスへテスト通知、`-- --token <hex>` =
    DB 登録前の実機検証、`-- --briefing` = 最新ブリーフィングを LLM 再生成なしで再 push、
    `-- --fixture` = ネットワーク・.env なしで JWT と payload 組み立てを検証）
  - フィクスチャ検証済み（JWT のヘッダ/クレーム/JOSE 形式署名の公開鍵検証、payload の 4KB トリム）。
    自己生成 .p8 + sandbox 実エンドポイントで HTTP/2 送信経路も確認済み
    （403 InvalidProviderToken が正しくパースされる）。
    **実機への到達確認は `.env` に APNS_* 投入後、
    `npm run apns:check -- --token <デバイストークン>`（アプリ実装後は `npm run apns:check`）で行う**
- [ ] Step 7: iOS アプリ雛形（通知登録 → トークン送信 → ブリーフィング表示）
- [ ] Step 8: cron で毎朝 07:00 PT 実行 → エンドツーエンド確認

## 影響範囲

新規コード（backend + iOS アプリ）。既存コードなし。g3plus に cron エントリと常駐サービスを追加。

## テスト方針

- 各コレクタは単体で「実データが取れる」ことを確認（Calendar/Gmail/Canvas）
- LLM 出力は手動レビュー（トリアージが spec のルール通りか）
- APNs は sandbox 環境で実機に届くことを確認
- エンドツーエンド: cron を手動起動 → iOS 実機に日本語ブリーフィングが届く

## 未確定・実装中に詰める点

- Gmail の「要対応」抽出クエリの具体化（ラベル・エイリアス活用）
- ブリーフィングの文面フォーマット（項目順・長さ）
