# タスク追加したらメールする

## 目的・背景

iOS アプリ / 管理画面からタスクを追加したとき、ユーザー（akiraak@gmail.com）宛にメールで通知する。
追加したタスクが受信トレイに記録として残り、リマインドとして機能する。

対象となる「タスク追加」は次の 2 系統（どちらも同じ「追加」操作なので両方を対象にする。片方で良ければ Step 2 で絞る）:

- **日々のタスク**: `POST /todos/daily`（iOS）と `POST /admin/daily-todos`（管理画面。ハンドラは iOS 用と同一 `handleAddDailyTodo`）
- **リポジトリ TODO**: `POST /todos/repo`（`handleAddRepoTodo` → GitHub の TODO.md へコミット）

完了操作（`/todos/daily/complete`）では送らない。追加時のみ。

## 対応方針

### 送信手段: Gmail API `users.messages.send`（スコープ追加）

backend は既に googleapis + OAuth リフレッシュトークンで Gmail を読んでいるため、これを流用するのが依存最小。

- `src/auth/google.ts` の `GOOGLE_SCOPES` に `https://www.googleapis.com/auth/gmail.send` を追加（冒頭コメントの「Calendar / Gmail とも読み取り専用」も修正）
- **既存のリフレッシュトークンは新スコープを含まないため、`npm run google:auth` を再実行して `GOOGLE_REFRESH_TOKEN` を差し替える必要がある（ローカルと g3plus の両方）**。差し替えるまで送信は insufficient scope で失敗するが、後述の fire-and-forget 設計によりタスク追加機能自体は壊れない

他案との比較: SMTP（nodemailer 追加 or 自前実装 + アプリパスワード管理）や外部サービス（SendGrid 等のアカウント追加）は依存・運用が増えるため見送り。

### Step 1: メール送信基盤

- `src/mail/send.ts` を新設: `sendMail(subject, body)` — RFC 5322 の raw メッセージを組み立てて base64url エンコードし `gmail.users.messages.send({ userId: 'me', requestBody: { raw } })` で送信
  - 日本語件名のため Subject は RFC 2047 の Base64 エンコード（`=?UTF-8?B?...?=`）、本文は `Content-Type: text/plain; charset=UTF-8` + Base64
  - From は認証アカウント（me）なので Gmail 側が補完。To は設定値
- `config.ts` に `mail: { notifyTo: optional('NOTIFY_EMAIL_TO') }` を追加
  - **`NOTIFY_EMAIL_TO` 未設定ならメール通知は無効（送らずログのみ）**。ローカル開発・テストサーバでの誤送信を防ぐ fail-safe
- `src/mail/check.ts` + `npm run mail:check` を新設（apns:check と同パターンの実送信スモークテスト）

### Step 2: タスク追加ハンドラへの組み込み

`src/server.ts` の成功パス（`sendJson(res, 200, ...)` の直前後）でメール送信を **fire-and-forget**（await せず、失敗は `console.error` のみ）:

- API 応答をブロックしない・メール失敗でもタスク追加は成功扱い
- `handleAddDailyTodo`: 件名「[ai-secretary] タスク追加: <text>」、本文に種別（今日のタスク）と追加時刻（シアトル時刻）
- `handleAddRepoTodo`: 件名は同形式、本文に種別（リポジトリ TODO）・repo 名・コミット URL
- 管理画面の `/admin/daily-todos` は同一ハンドラなので自動的に対象になる

### Step 3: ドキュメント・デプロイ・検証

- `.env.example` に `NOTIFY_EMAIL_TO` を追記
- `docs/specs/deploy-g3plus.md` に「スコープ追加に伴う `GOOGLE_REFRESH_TOKEN` の再取得手順」と `NOTIFY_EMAIL_TO` を追記
- g3plus 側で再認証・環境変数設定（デプロイ時の作業）

## 影響範囲

- `backend/src/auth/google.ts`（スコープ追加）、`backend/src/config.ts`、`backend/src/server.ts`（追加ハンドラ 2 箇所）
- 新規: `backend/src/mail/send.ts`、`backend/src/mail/check.ts`
- `backend/package.json`（mail:check スクリプト）、`backend/.env.example`、`docs/specs/deploy-g3plus.md`
- DB・API レスポンス・iOS・管理画面 UI・LLM 層は変更なし

## リスク・注意点

- **自分宛メールがブリーフィングの「要対応候補」に混入する可能性**: Gmail コレクタは `-in:sent` で絞っており、自分宛送信メールは SENT ラベルが付くため通常は除外されるはず。実装後に `collectors:check` で確認し、漏れる場合はクエリに `-subject:"[ai-secretary]"` を追加する
- スコープ追加後、再認証するまでの間は送信が失敗し続ける（ログに出るだけで実害なし）。ローカル → g3plus の順に差し替える
- 送信頻度は手動追加のみなのでレート制限は考慮不要

## テスト方針

- `npm run typecheck`
- `npm run mail:check` で実送信（日本語件名・本文のエンコード確認）
- テスト DB + ローカル API サーバ + curl:
  - `POST /todos/daily` → 200 + メール到着（内容・時刻表記）
  - `POST /todos/repo` → 200 + メール到着（repo 名・URL 入り）
  - `NOTIFY_EMAIL_TO` 未設定時: 送信されずログのみ、200 は変わらず
  - 送信失敗時（旧トークンのまま等）: 200 が返り、エラーはログのみ
- `npm run collectors:check` で通知メールが要対応候補に混ざらないことを確認
