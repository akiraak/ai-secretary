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

/** push 対象の全デバイス（Step 6 の APNs 送信で使う）。 */
export function listDevices(): DeviceRow[] {
  return getDb().prepare('SELECT * FROM devices ORDER BY id').all() as DeviceRow[];
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
