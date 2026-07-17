# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

ユーザー(Akira Kozakai)をサポートするパーソナル秘書アプリを構築するプロジェクト。GitHub リポジトリはプライベート設定。

## アーキテクチャ

毎朝 07:00 PT に backend が「予定・締切・要対応メール・GitHub 活動」を収集 → LLM で日本語ブリーフィングに整形 → SQLite に保存 → APNs で iOS アプリへ push する。詳細は [docs/plans/mvp-morning-briefing.md](docs/plans/mvp-morning-briefing.md)。

- `backend/` — TypeScript / Node（フレームワークなし、依存最小）。
  `src/collectors/`（Calendar / Gmail / Canvas iCal / GitHub / TODO.md）→ `src/llm/`（Claude Haiku 4.5 でトリアージ・整形）→ `src/db/`（better-sqlite3。SQL は `db/repo.ts` に集約）→ `src/push/`（APNs を node:crypto + node:http2 で自前実装）。
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

## 作業方針

- ユーザーとのやり取りは日本語で行う

<!-- vibeboard:begin -->
## 開発管理画面 (vibeboard)

ローカル開発時のタスク・プラン管理は [vibeboard](https://github.com/akiraak/vibeboard) で行う。
プロジェクト直下に degit で vendor してある（`./vibeboard/`）。

```bash
# 親プロジェクト直下から
node vibeboard/dist/cli.js --root .
```

`http://localhost:3010` でプロジェクト直下の `docs/plans/`・`docs/specs/`・`TODO.md`・`DONE.md`・`CLAUDE.md`・`README.md` を閲覧・編集できる。

- `Root` タブで `TODO.md` / `DONE.md` / `CLAUDE.md` / `README.md` をプレビュー表示・編集できる
  - 編集は楽観ロック（mtime チェック）付き。外部で先に更新されていた場合は保存時に 409 を返し、リロード / 手元維持 / 強制上書き を選べる
  - `fs.watch` + 2 秒ポーリングで外部変更を検知し、SSE でクライアントへ即時反映する
- ローカル開発専用（本番管理画面とは独立）
- ポート変更は `--port` または `VIBEBOARD_PORT` 環境変数で指定可能

## タスク管理ルール

- タスクは `TODO.md` で管理する
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
<!-- vibeboard:end -->

### このプロジェクト固有の vibeboard 設定

ポート 3010 は別プロジェクトが使用しているため、`vibeboard.config.json` でポートを **3011** に固定している。管理画面は `http://localhost:3011` で開く。
