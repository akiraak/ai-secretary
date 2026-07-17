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
