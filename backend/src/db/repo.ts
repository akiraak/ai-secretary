// devices / briefings / collector_runs への読み書き。SQL はこのファイルに集約する。
import { getDb } from './index.js';
import type { BriefingRow, DeviceRow } from '../types.js';

/** デバイストークンを登録する。既存トークンなら platform と updated_at を更新する。 */
export function upsertDevice(token: string, platform = 'ios'): DeviceRow {
  return getDb()
    .prepare(
      `INSERT INTO devices (token, platform) VALUES (?, ?)
       ON CONFLICT(token) DO UPDATE SET
         platform = excluded.platform,
         updated_at = datetime('now')
       RETURNING *`,
    )
    .get(token, platform) as DeviceRow;
}

/** push 対象の全デバイス（APNs 送信で使う）。 */
export function listDevices(): DeviceRow[] {
  return getDb().prepare('SELECT * FROM devices ORDER BY id').all() as DeviceRow[];
}

/** デバイスを削除する（APNs が 410 Unregistered を返した失効トークン）。 */
export function deleteDevice(id: number): void {
  getDb().prepare('DELETE FROM devices WHERE id = ?').run(id);
}

/** 生成したブリーフィングを保存し、行 id を返す。 */
export function insertBriefing(row: {
  briefingDate: string;
  lang: string;
  title: string;
  summary: string;
  payloadJson: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO briefings (briefing_date, lang, title, summary, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(row.briefingDate, row.lang, row.title, row.summary, row.payloadJson);
  return Number(result.lastInsertRowid);
}

/** 最新のブリーフィング 1 件（GET /briefings/latest のソース）。 */
export function latestBriefing(): BriefingRow | undefined {
  return getDb().prepare('SELECT * FROM briefings ORDER BY id DESC LIMIT 1').get() as
    | BriefingRow
    | undefined;
}

/** push 完了時刻を記録する（1 台以上に送信成功したとき）。 */
export function markBriefingPushed(id: number): void {
  getDb().prepare("UPDATE briefings SET pushed_at = datetime('now') WHERE id = ?").run(id);
}

/** push 送信結果を 1 デバイス分記録する。 */
export function insertPushLog(log: {
  briefingId: number;
  deviceId: number;
  status: 'sent' | 'failed';
  apnsId?: string;
  error?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO push_log (briefing_id, device_id, status, apns_id, error)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(log.briefingId, log.deviceId, log.status, log.apnsId ?? null, log.error ?? null);
}

/** 直近のコレクタ実行結果（管理画面用。raw_json は重いので返さない）。 */
export function recentCollectorRuns(limit = 10): Array<{
  id: number;
  briefing_date: string;
  source: string;
  status: string;
  error: string | null;
  created_at: string;
}> {
  return getDb()
    .prepare(
      `SELECT id, briefing_date, source, status, error, created_at
       FROM collector_runs ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as ReturnType<typeof recentCollectorRuns>;
}

/** 直近の push 送信結果（管理画面用。デバイストークンはマスクして返す）。 */
export function recentPushLogs(limit = 10): Array<{
  id: number;
  briefing_id: number;
  device: string;
  status: string;
  apns_id: string | null;
  error: string | null;
  created_at: string;
}> {
  return getDb()
    .prepare(
      `SELECT p.id, p.briefing_id, substr(d.token, 1, 8) || '…' AS device,
              p.status, p.apns_id, p.error, p.created_at
       FROM push_log p JOIN devices d ON d.id = p.device_id
       ORDER BY p.id DESC LIMIT ?`,
    )
    .all(limit) as ReturnType<typeof recentPushLogs>;
}

/** settings の値（JSON 文字列）を返す。未設定なら undefined。 */
export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** settings に値（JSON 文字列）を保存する。 */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now')`,
    )
    .run(key, value);
}

/** 締切を手動完了にする（uid = ics の UID。再チェックは completed_at を更新）。 */
export function completeDeadline(uid: string, title: string, dueAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO deadline_completions (uid, title, due_at) VALUES (?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         title = excluded.title,
         due_at = excluded.due_at,
         completed_at = datetime('now')`,
    )
    .run(uid, title, dueAt);
}

/** 締切の完了チェックを解除する。 */
export function uncompleteDeadline(uid: string): void {
  getDb().prepare('DELETE FROM deadline_completions WHERE uid = ?').run(uid);
}

/** 完了済み締切の uid 一覧。 */
export function listCompletedDeadlineUids(): string[] {
  const rows = getDb().prepare('SELECT uid FROM deadline_completions').all() as { uid: string }[];
  return rows.map((r) => r.uid);
}

/**
 * 締切日が cutoffDate（YYYY-MM-DD）より前の完了行を削除する（テーブル肥大防止）。
 * due_at は ISO8601 / YYYY-MM-DD 混在だが、日付境界との辞書順比較はどちらの形式でも正しい。
 */
export function cleanupDeadlineCompletions(cutoffDate: string): number {
  const result = getDb()
    .prepare('DELETE FROM deadline_completions WHERE due_at < ?')
    .run(cutoffDate);
  return result.changes;
}

/** TODO サマリーのキャッシュを引く。無ければ undefined。 */
export function getTodoSummaryCache(hash: string): string | undefined {
  const row = getDb()
    .prepare('SELECT summary FROM todo_summary_cache WHERE hash = ?')
    .get(hash) as { summary: string } | undefined;
  return row?.summary;
}

/** TODO サマリーをキャッシュに保存し、30 日超の古い行を掃除する。 */
export function saveTodoSummaryCache(hash: string, summary: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO todo_summary_cache (hash, summary) VALUES (?, ?)
     ON CONFLICT(hash) DO UPDATE SET
       summary = excluded.summary,
       created_at = datetime('now')`,
  ).run(hash, summary);
  db.prepare("DELETE FROM todo_summary_cache WHERE created_at < datetime('now', '-30 days')").run();
}

/** calendar_items の 1 行（変更検知用スナップショット） */
export interface CalendarItemRow {
  key: string;
  source: 'calendar' | 'canvas';
  fingerprint: string;
  start_at: string;
  title: string;
}

/** 指定ソースの前回スナップショット全件。 */
export function listCalendarItems(source: 'calendar' | 'canvas'): CalendarItemRow[] {
  return getDb()
    .prepare('SELECT key, source, fingerprint, start_at, title FROM calendar_items WHERE source = ?')
    .all(source) as CalendarItemRow[];
}

/** 指定ソースのスナップショットを今回の収集内容で丸ごと置き換える。 */
export function replaceCalendarItems(
  source: 'calendar' | 'canvas',
  items: Omit<CalendarItemRow, 'source'>[],
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO calendar_items (key, source, fingerprint, start_at, title)
     VALUES (?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM calendar_items WHERE source = ?').run(source);
    for (const it of items) insert.run(it.key, source, it.fingerprint, it.start_at, it.title);
  })();
}

/** 指定ソースの最新の成功したコレクタ実行（GET /deadlines のデータ源）。 */
export function latestCollectorRunRaw(
  source: string,
): { raw_json: string | null; created_at: string } | undefined {
  return getDb()
    .prepare(
      `SELECT raw_json, created_at FROM collector_runs
       WHERE source = ? AND status = 'ok' ORDER BY id DESC LIMIT 1`,
    )
    .get(source) as ReturnType<typeof latestCollectorRunRaw>;
}

/** LLM API 呼び出しの usage を記録する。 */
export function insertLlmUsage(row: {
  briefingDate?: string;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO llm_usage (briefing_date, purpose, model, input_tokens, output_tokens,
                              cache_creation_input_tokens, cache_read_input_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.briefingDate ?? null,
      row.purpose,
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.cacheCreationInputTokens,
      row.cacheReadInputTokens,
      row.costUsd,
    );
}

/** AI 利用状況のサマリ（今月・累計。月区切りは UTC）。 */
export function llmUsageSummary(): {
  monthCalls: number;
  monthCostUsd: number;
  totalCalls: number;
  totalCostUsd: number;
  models: string[];
} {
  const db = getDb();
  const month = db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost
       FROM llm_usage WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`,
    )
    .get() as { calls: number; cost: number };
  const total = db
    .prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost FROM llm_usage`)
    .get() as { calls: number; cost: number };
  const models = db
    .prepare(`SELECT DISTINCT model FROM llm_usage ORDER BY model`)
    .all() as { model: string }[];
  return {
    monthCalls: month.calls,
    monthCostUsd: month.cost,
    totalCalls: total.calls,
    totalCostUsd: total.cost,
    models: models.map((m) => m.model),
  };
}

/** 月別の AI 利用集計（新しい月から最大 limit ヶ月。月区切りは UTC）。 */
export function monthlyLlmUsage(limit = 12): Array<{
  month: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
}> {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
              SUM(cache_read_input_tokens) AS cache_read_input_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM llm_usage GROUP BY month ORDER BY month DESC LIMIT ?`,
    )
    .all(limit) as ReturnType<typeof monthlyLlmUsage>;
}

/** 直近の AI 呼び出し履歴（管理画面用）。 */
export function recentLlmUsage(limit = 20): Array<{
  id: number;
  briefing_date: string | null;
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number | null;
  created_at: string;
}> {
  return getDb()
    .prepare(`SELECT * FROM llm_usage ORDER BY id DESC LIMIT ?`)
    .all(limit) as ReturnType<typeof recentLlmUsage>;
}

/** コレクタ実行結果を記録する（デバッグ・再生成用）。 */
export function insertCollectorRun(run: {
  briefingDate: string;
  source: string;
  status: 'ok' | 'error';
  rawJson?: string;
  error?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO collector_runs (briefing_date, source, status, raw_json, error)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(run.briefingDate, run.source, run.status, run.rawJson ?? null, run.error ?? null);
}
