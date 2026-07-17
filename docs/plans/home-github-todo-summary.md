# HOME「今日やる」→「GitHub」: TODO.md の LLM サマリー表示

作成日: 2026-07-17

## 目的・背景

HOME の「今日やる」セクションは `payload.todos`（各リポジトリの TODO.md 未完了タスク）の
先頭 5 件をそのまま並べているだけで、優先度の意味はなく、済チェックも画面内限りで永続しない。
全量は GitHub タブが既に表示している（役割分担: 要点は HOME、全量は各タブ）。

そこで HOME 側を以下に変更する（ユーザー決定）:

- セクション名を「今日やる」→「**GitHub**」に変更（タップで GitHub タブへ、は現状維持）
- 内容は **LLM が生成した TODO.md のサマリー**（日本語プロース）にする
- サマリーは **キャッシュ**し、TODO の内容が前回と変わらなければ LLM を呼ばず生成済みを返す
- 「次の作業」折りたたみセクション（TODO 6 件目以降）は **削除**（全量は GitHub タブ）

## 対応方針

### Phase 1: backend — TODO サマリー生成 + キャッシュ

1. `src/llm/todoSummary.ts`（新規）
   - `hashTodos(todos)`: `repo\ttext` を連結し sha256。プロンプト版数とモデル ID も
     ハッシュに含める（プロンプト変更時にキャッシュを自然に無効化するため）
   - `generateTodoSummary(todos)`: Claude（`config.llm.model`）へ構造化出力
     `{summary}` で 2〜3 文の日本語サマリーを生成。リトライは briefing.ts の
     `createMessageWithRetry` を export して共用
2. `src/db/schema.sql` + `src/db/repo.ts`
   - テーブル `todo_summary_cache (hash PRIMARY KEY, summary, created_at)` を追加
   - `getTodoSummaryCache(hash)` / `saveTodoSummaryCache(hash, summary)`（保存時に
     30 日超の古い行を掃除）
3. `src/jobs/runBriefing.ts`
   - 収集後にハッシュ → キャッシュ命中なら再利用（LLM 呼び出しなし）、ミスなら生成して
     `llm_usage`（purpose=`todo_summary`）に記録しキャッシュ保存
   - 生成失敗はブリーフィング全体を止めず warn して `todoSummary` なしで続行
   - `briefing.payload.todoSummary` に設定（deadlines の annotated と同じ後付けパターン）
4. `src/types.ts`: `BriefingPayload.todoSummary?: string`（旧 payload には無い）
5. `src/llm/check.ts`: `--fixture` 検証に TODO サマリー生成を追加

### Phase 2: iOS — HOME セクション差し替え

1. `Models.swift`: `BriefingPayload.todoSummary: String?` を追加
2. `HomeView.swift`
   - セクション名「今日やる」→「GitHub」（linkTab: .github は維持）
   - 内容 = `todoSummary` のプロース表示。無い場合のフォールバック:
     - todos が空 → 「TODO は登録されていません」
     - todos があるのに summary が無い（旧 payload / 生成失敗）→ リポジトリ別件数表示
   - 済チェック（doneTodos）・`todayTodoCount`・「次の作業」折りたたみを削除

### Phase 3: ドキュメント更新

- `docs/specs/ios-app-screens.md` の HOME セクション構成を更新
- `src/types.ts` / 各ファイルのヘッダコメントの「今日やる」表記を更新

## 影響範囲

- backend: llm / db / jobs / types（server.ts は payload パススルーのため変更なし）
- iOS: HomeView のみ（GitHubTabView は全量表示のまま変更なし）
- 旧 payload（todoSummary なし）はフォールバック表示で互換維持

## テスト方針

- `npm run typecheck`
- `npm run llm:check -- --fixture` で TODO サマリー生成を実測確認
- キャッシュ動作は DB_PATH を一時ファイルに向けた検証スクリプトで
  「同一 todos → 2 回目はキャッシュ命中 / 内容変更 → 再生成」を確認
- iOS はシミュレータビルド（xcodegen generate → xcodebuild）
