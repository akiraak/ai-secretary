# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ユーザー(Akira Kozakai)をサポートするパーソナル秘書アプリを構築するプロジェクト。GitHub リポジトリはプライベート設定。

## アーキテクチャ

毎朝 07:00 PT に backend が「予定・締切・要対応メール・GitHub 活動」を収集 → LLM で日本語ブリーフィングに整形 → SQLite に保存 → APNs で iOS アプリへ push する。詳細は [docs/plans/archive/mvp-morning-briefing.md](docs/plans/archive/mvp-morning-briefing.md)。

- `backend/` — TypeScript / Node（フレームワークなし、依存最小）。
  `src/collectors/`（Calendar / Gmail / Canvas iCal / GitHub / TODO.md / 買い物リスト）→ `src/llm/`（Claude Haiku 4.5 でトリアージ・整形）→ `src/db/`（better-sqlite3。SQL は `db/repo.ts` に集約）→ `src/push/`（APNs を node:crypto + node:http2 で自前実装）。
  `src/server.ts` = API（POST /devices, GET /briefings/latest。Bearer 共有シークレット認証）。
  `scripts/cron-briefing.sh` = cron 用ラッパ、`deploy/` = crontab 例 + systemd unit。g3plus への配置手順は [docs/specs/deploy-g3plus.md](docs/specs/deploy-g3plus.md)
- `ios/` — Swift / SwiftUI アプリ（iOS 17+、外部依存なし）。オンボーディング（通知許可 → POST /devices）+ 4 タブ（HOME 統合フィード / GitHub / Calendar / Setting）。`Models.swift` は backend の `src/types.ts` と 1:1。画面設計は [docs/specs/ios-app-screens.md](docs/specs/ios-app-screens.md)
- Bundle ID `com.akiraak.ai-secretary` は backend の `APNS_BUNDLE_ID` と一致させること

## ビルド・実行コマンド

backend（`cd backend`、Node >= 22、設定は `.env` — `.env.example` 参照）:

```bash
npm run typecheck            # tsc --noEmit（テストは未整備。検証は各 check スクリプトで）
npm start                    # API サーバ起動（要 API_SHARED_SECRET）
npm run briefing             # 収集 → LLM 生成 → 保存 → push を 1 回実行（cron から呼ぶ）
npm run collectors:check     # コレクタの実データ取得確認
npm run diff:check           # カレンダー変更検知ロジックの単体検証（DB・.env 不要）
npm run llm:check -- --fixture   # LLM 層のみ検証（--fixture はサンプル入力）
npm run apns:check -- --fixture  # APNs 層のみ検証（実機へは --token <hex>）
```

ios（`cd ios`。`.xcodeproj` は XcodeGen 生成物で git 管理外）:

```bash
xcodegen generate            # project.yml から AISecretary.xcodeproj を生成
xcodebuild -project AISecretary.xcodeproj -scheme AISecretary \
  -destination 'platform=iOS Simulator,name=iPhone 17' build CODE_SIGNING_ALLOWED=NO
```

実機ビルドは `Config/Local.example.xcconfig` を `Local.xcconfig` にコピーして `DEVELOPMENT_TEAM` を設定（git 管理外）。

ローカルで管理画面付き API サーバを起動するにはリポジトリ直下の `./run-admin.sh`（ポート占有プロセスを停止してから起動し、ブラウザで `/admin` を開く）。

実機へのビルド & インストールはリポジトリ直下の `./run-ios-device.sh` を使う（`--local`（既定）= Mac の LAN IP を接続先として焼き込み / `--prod` = `https://secretary.chobi.me`。`backend/.env` の `API_SHARED_SECRET` も注入される）。

## 本番デプロイ (g3plus)

本番は g3plus サーバ上の Docker コンテナ `ai-secretary`（port 3008、`https://secretary.chobi.me`。単一コンテナで API サーバ + crond〔briefing 07:00 PT〕）。**手順の正本は `../g3plus-ops/docs/workflows/ai-secretary.md`**、デプロイ設定（docker-compose.yml / Dockerfile / `.env`）の正本は `../g3plus-ops/ai-secretary/`。build context は g3plus 上に clone した本リポジトリ（`/home/ubuntu/ai-secretary`）なので、**main へ push したコミットだけが反映される**。

通常の更新（アプリコードの変更）は、main へ push した後:

```bash
ssh -i ~/.ssh/id_rsa_nopass ubuntu@g3plus.lan \
  'git -C /home/ubuntu/ai-secretary pull origin main &&
   docker compose --project-directory /home/ubuntu/g3plus-ops/ai-secretary build &&
   docker compose --project-directory /home/ubuntu/g3plus-ops/ai-secretary up -d'
ssh -i ~/.ssh/id_rsa_nopass ubuntu@g3plus.lan 'docker logs ai-secretary --tail 20'
# 期待ログ: "ai-secretary API サーバ起動: http://localhost:3008"
```

環境変数の変更（追加・差し替え。例: `GOOGLE_REFRESH_TOKEN` の再取得後）は
`../g3plus-ops/ai-secretary/.env`（git 管理外の正本）を編集してから転送 → 再起動:

```bash
scp -i ~/.ssh/id_rsa_nopass ../g3plus-ops/ai-secretary/.env \
  ubuntu@g3plus.lan:/home/ubuntu/g3plus-ops/ai-secretary/.env
ssh -i ~/.ssh/id_rsa_nopass ubuntu@g3plus.lan \
  'docker compose --project-directory /home/ubuntu/g3plus-ops/ai-secretary up -d'
```

- env を追加したら `.env.example`（本リポジトリ `backend/` と `../g3plus-ops/ai-secretary/` の両方）も追従させ、`../g3plus-ops` はコミット・push する
- デプロイ後の動作確認: `curl -s -o /dev/null -w '%{http_code}' https://secretary.chobi.me/briefings/latest -H "Authorization: Bearer <API_SHARED_SECRET>"` が 200（secret は `backend/.env` と同じ値）。認証なしは 401 が正
- コンテナ内でのスモークテスト（check スクリプト類）: `ssh -i ~/.ssh/id_rsa_nopass ubuntu@g3plus.lan 'docker exec ai-secretary sh -lc ". /app/backend/container-env.sh; cd /app/backend && npm run mail:check"'` のように `container-env.sh` を source してから実行する（crond と同じ env 伝播方式）
- briefing の手動実行は管理画面 `https://secretary.chobi.me/admin` の「今すぐ実行」、障害時の調べ方は workflow doc を参照

## 作業方針

- ユーザーとのやり取りは日本語で行う

## 開発管理画面

タスク・プラン・ファイルの閲覧と編集、Claude Code への依頼は project-manager（`http://127.0.0.1:8200`、`~/project-manager`）で行う。vibeboard は 2026-10 に撤去した。

## タスク管理ルール

- タスクは `TODO.md` で管理する
- **タスクの行は、親項目も含めて必ず `- [ ] 文面` の形で書く。** vibeboard はチェックボックス
  （`[ ]` 未着手 / `[x]` 完了 / `[~]` 進行中 / `[-]` 中止）のある行だけをタスクとして拾う。
  `- 文面` のようにチェックボックスの無い行はタスクではなく直前のタスクのメモ扱いになり、ツリーにも
  Tasks タブにも出ない（親に付け忘れると、子タスクだけが親を失って並ぶ）
- **`TODO.md` に書くのはタスクだけ。** メモや決定事項を残すときは、関係するタスクの
  下に字下げして付ける（タスクに関連付ける）。タスクに属さないメモの節（「決まったこと」「備考」など）は
  作らない。プロジェクトとしての決定は `CLAUDE.md` へ、済んだ経緯は `DONE.md` へ書く
- 字下げが親子。vibeboard はこれをツリーとして表示する

  ```markdown
  - [ ] 親タスク [plan](docs/plans/foo.md)
    - [x] Step 1: 済んだ子タスク
    - [~] Step 2: 進行中の子タスク
      - 決定: この子タスクに付くメモ（チェックボックスなし）
  ```
- タスク同士の関係は、そのタスクの下に字下げした **`依存:` / `派生元:` / `関連:`** の行で書く。
  相手のタスクは `「文面」` で（例: `依存: 「スキーマに tags 列を追加」`）、プランや仕様は
  Markdown リンクで（例: `関連: [spec](docs/specs/api.md)`）示す。vibeboard のツリーで両方向に辿れる
- タスクの**期日**（いつやるか）は、そのタスクの下に字下げした **`期日:`** の行で書く（例: `期日: 2026-09-21` /
  `期日: 2026-09-21 06:35` / `期日: 2026-09-21 12:45〜13:05`）。時刻だけの行（`期日: 06:35`）は、親をさかのぼって
  最初に見つかる期日の日付を借りる。vibeboard の Tasks タブの「タイムライン」が、期日のあるタスクを日ごと・時刻の順に並べる
- タスクが完了したら `TODO.md` から該当項目を削除し、`DONE.md` に移動する
- `DONE.md` には完了日を `YYYY-MM-DD` 形式で付けて記録する
- 新しいタスクが発生したら `TODO.md` の適切なセクションに追加する
- タスクの実施前に `TODO.md` を確認し、優先度の高いものから着手する
- コミット時に `TODO.md` を確認し、実装した機能に対応するタスクがあれば `DONE.md` に移動する

## 作業着手ルール

作業（実装・調査いずれも）を始めるときは、コードに手を入れる前に以下を行う。

1. **プランファイルを作成する**: `docs/plans/<task-name>.md` に実装プラン or 調査プランを作成する
   - 目的・背景、対応方針、影響範囲、テスト方針を最低限記載する
   - 複数 Phase / Step に分かれる場合はファイル内でも Phase / Step を明示する
2. **`TODO.md` に該当項目があるか確認する**
   - 無ければ適切なセクションに追加する
   - 既存項目があれば、その項目に作成したプランファイルへのリンクを追記する（例: `[plan](docs/plans/<task-name>.md)`）
3. **複数 Phase / Step がある場合は `TODO.md` に子タスクとして追加する**
   - 親項目の下にインデントしたチェックボックスで Phase / Step を列挙する
   - Phase / Step が完了するごとにチェックを入れ、全完了で親項目を `DONE.md` に移す
4. **作業完了時の後片付け**
   - 親タスクを `DONE.md` に移動する
   - 対応するプランファイルは `docs/plans/archive/` に移動する

### このプロジェクト固有の vibeboard 設定

ポート 3010 は別プロジェクトが使用しているため、`vibeboard.config.json` でポートを **3011** に固定している。管理画面は `http://localhost:3011` で開く。
