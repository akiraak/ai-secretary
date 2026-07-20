# 日々の作業 TODO を追加・保存できるようにする

## 目的・背景

日々の作業中に発生するタスク(「あとで〇〇する」「今日中に△△」)を書き留める場所が今は無い。
既存の TODO は各リポジトリの `TODO.md`(= プロジェクト単位のタスク)であり、
リポジトリに紐づかない当日の雑務・生活タスクの置き場がない。

iOS アプリ / 管理画面からサッと追加でき、完了チェックでき、永続化される「日々のタスク」を作る。

## 保存先の設計判断

| 案 | 内容 | 評価 |
|---|---|---|
| **A. backend の SQLite(採用)** | `daily_todos` テーブルを新設し API で読み書き | 既存アーキテクチャ(`deadline_completions` / `settings` と同型)に沿う。git 依存なし・オフライン(GitHub 障害時)でも動く。追加/完了が即時反映 |
| B. どこかのリポジトリの `TODO.md` | 「アプリからリポジトリの TODO へタスクを追加」([plan](app-add-repo-todo.md))の書き込み経路を流用 | 追加のたびに git コミットが発生しノイズ。プロジェクトタスクと雑務が混ざる。完了チェックも毎回コミットになる |
| C. 外部サービス(Todoist 等) | 外部 API 連携 | 依存最小の方針に反する。過剰 |

→ **A を採用**。日々のタスクは backend が正本を持ち、リポジトリ TODO.md(プロジェクトタスク)とは別系統として扱う。

## 対応方針

### データモデル

`backend/src/db/schema.sql` に追加:

```sql
CREATE TABLE IF NOT EXISTS daily_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT              -- NULL = 未完了
);
```

- 未完了タスクは日をまたいで残り続ける(繰り越し)。完了で `completed_at` を記録
- 削除は当面持たない(誤追加は完了で消す)。必要になったら後続で

### API(`src/server.ts`)

iOS 用(Bearer 必須帯):

- `GET  /todos/daily` — 未完了全件 + 当日(シアトル時刻)完了分を返す `{todos: [{id, text, createdAt, completedAt?}]}`
- `POST /todos/daily` — 追加 `{text}`(1〜200 文字・改行不可)
- `POST /todos/daily/complete` — 完了/取り消し `{id, completed}`(`/deadlines/complete` と同型)

管理画面用(`/admin` 帯・Bearer なし・ADMIN_ENABLED fail-safe 対象):

- `GET/POST /admin/daily-todos`、`POST /admin/daily-todos/complete` — ハンドラは iOS 用と共用

SQL は方針どおり `db/repo.ts` に集約(`addDailyTodo` / `listDailyTodos` / `setDailyTodoCompleted`)。

### iOS(HOME タブ)

- HOME の「締切が近い」の上あたりに「今日のタスク」セクションを追加
  - データは briefing payload ではなく `GET /todos/daily` をライブ取得(締切の完了状態同期と同方針。日中に追加したものを朝の payload 更新を待たず表示するため)
  - 行: チェックボックス(タップで complete API)+ テキスト
  - セクション末尾に追加フィールド(TextField + 追加ボタン。送信中はスピナー、成功でリスト更新)
- `BackendClient` に `fetchDailyTodos` / `addDailyTodo` / `setDailyTodoCompleted` を追加
- `Models.swift` に対応する型を追加(backend のレスポンスと 1:1)

### 管理画面(`assets/admin.html`)

- サイドバーに「タスク」ページを新設: 一覧(未完了 + 当日完了)+ 追加フォーム + 完了チェック
- ページ表示時に読み込み(3 秒ポーリング対象外。買い物リストページと同方針)

### ブリーフィングへの組み込み(任意・最後)

- `BriefingPayload.dailyTodos?`(optional。旧 payload には無い)として未完了分を保存時に同梱
- LLM プロンプトには当面入れない(買い物リストと同方針)。朝の文面に含めたくなったら後続で

## 影響範囲

- backend: `db/schema.sql` / `db/repo.ts` / `server.ts` / `types.ts` /(Phase 4)`briefing.ts` 相当の組み立て箇所
- iOS: `Models.swift` / `BackendClient.swift` / `Views/HomeView.swift`
- 管理画面: `assets/admin.html`
- コレクタ・LLM 層・push・cron は不変。既存 API の互換性も不変

## Phase 分割

- Phase 1: DB(テーブル追加 + repo.ts)+ API 3 本(iOS 用)+ admin 用 3 本
- Phase 2: 管理画面「タスク」ページ
- Phase 3: iOS HOME「今日のタスク」セクション(表示・追加・完了)
- Phase 4(任意): briefing payload への同梱

## テスト方針

- `npm run typecheck`
- テスト DB + ローカル API サーバ + curl: 追加 → 一覧 → 完了 → 一覧の一連、認証境界(iOS 用 401 / admin 帯は ADMIN_ENABLED 無しで 404)、バリデーション(空文字・201 文字・改行入り 400)
- 管理画面: script 部を `node --check` + headless Chrome + CDP でページ切り替え・追加・完了チェック・JS エラーなしを確認
- iOS: シミュレータビルド + テスト DB とローカル API サーバ経由で表示・追加・完了をスクリーンショット確認
