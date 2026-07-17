# AI 利用状況を管理画面に表示

## 目的・背景

毎朝のブリーフィング生成で Claude API(既定 `claude-haiku-4-5`)を呼んでいるが、
使用モデル・トークン数・料金がどこにも記録されておらず、コストが見えない。
API レスポンスの `usage`(input/output/キャッシュトークン数)を保存し、
管理画面 `/admin` で「ダッシュボードに今月の料金」+「専用タブで詳細」を表示できるようにする。

## 対応方針

### Phase 1: backend — usage の記録と集計 API

1. **スキーマ**: `llm_usage` テーブルを追加(`db/schema.sql`。CREATE IF NOT EXISTS なので再適用で自動作成)
   - `purpose`(briefing 等)/ `briefing_date` / `model` / `input_tokens` / `output_tokens` /
     `cache_creation_input_tokens` / `cache_read_input_tokens` / `cost_usd`(単価不明モデルは NULL)/ `created_at`
2. **料金計算**: `src/llm/pricing.ts` を新設。モデル別単価表(2026-06 時点の公表価格)から 1 回分のコストを USD で計算
   - haiku-4-5: $1/$5 per 1M トークン、sonnet 系: $3/$15、opus 4.x: $5/$25
   - キャッシュ読み取りは入力単価の 0.1 倍、キャッシュ書き込み(5分 TTL)は 1.25 倍
   - モデル ID は前方一致で解決(エイリアスと日付付きフル ID の両対応)。未知モデルはコスト NULL
3. **LLM 層**: `generateBriefing` の戻り値に `usage`(トークン数 + コスト)を追加。DB への保存は行わない(層の分離を維持)
   - `llm:check` は usage とコストをコンソール表示するだけ(DB には書かない)
4. **ジョブ**: `jobs/runBriefing.ts` が生成後に `insertLlmUsage` で保存し、ログにトークン数とコストを出力
5. **集計**: `db/repo.ts` に追加
   - `insertLlmUsage` / `llmUsageSummary`(今月・累計)/ `monthlyLlmUsage`(月別 12 ヶ月)/ `recentLlmUsage`(直近 20 件)
   - 月区切りは SQLite `strftime` による UTC 基準(表示時刻はシアトルだが、集計簡素化のため境界のみ UTC)
6. **API**: `GET /admin/status` に今月コストのサマリを追加、`GET /admin/ai-usage` で詳細(サマリ + 月別 + 直近)を返す

### Phase 2: 管理画面 UI

1. サイドバーに「AI 利用状況」タブを追加(単一 HTML 内のセクション切り替え)
2. ダッシュボードに stat カード「AI 料金(今月)」を追加(status のサマリから)
3. AI 利用状況タブ: stat カード(今月コスト / 累計コスト / 今月呼び出し数 / 使用モデル)+ 月別集計テーブル + 直近の呼び出しテーブル

## 影響範囲

- `backend/src/db/schema.sql`, `db/repo.ts`(テーブル・クエリ追加。既存テーブルは変更なし)
- `backend/src/llm/briefing.ts`(戻り値拡張), `llm/pricing.ts`(新規), `llm/check.ts`(表示追加)
- `backend/src/jobs/runBriefing.ts`, `admin.ts`, `server.ts`, `assets/admin.html`
- 過去のブリーフィングの usage は残っていないため、記録は導入後の実行分から始まる

## テスト方針

- `npm run typecheck`
- `npm run llm:check -- --fixture` で実 API を 1 回呼び、usage とコストの計算・表示を確認
- `DB_PATH` を一時 DB に向けて API サーバを起動し、`insertLlmUsage` でサンプル行を投入 →
  `GET /admin/status` / `GET /admin/ai-usage` のレスポンスを curl で確認
- `./run-admin.sh` でブラウザ表示を最終確認(手動)
