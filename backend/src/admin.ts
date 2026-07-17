// 管理画面のバックエンド。ブリーフィングの手動実行（scripts/cron-briefing.sh を spawn）と
// 状態集約（最新ブリーフィング / デバイス / コレクタ / push ログ / 実行ログ末尾）を提供する。
// 多重起動はここでのプロセス内ガードに加え、スクリプト側の flock でも防いでいる。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_ROOT } from './config.js';
import { calendarClient } from './auth/google.js';
import {
  latestBriefing,
  listDevices,
  llmUsageSummary,
  monthlyLlmUsage,
  recentCollectorRuns,
  recentLlmUsage,
  recentPushLogs,
} from './db/repo.js';
import { config } from './config.js';
import { resolveCalendarIds, saveCalendarIds } from './settings.js';

const BRIEFING_SCRIPT = path.join(BACKEND_ROOT, 'scripts', 'cron-briefing.sh');
const LOG_DIR = path.join(BACKEND_ROOT, 'logs');
const LOG_TAIL_BYTES = 8 * 1024;

interface JobState {
  running: { startedAt: string; pid: number | undefined } | null;
  last: { startedAt: string; endedAt: string; exitCode: number | null } | null;
}

const job: JobState = { running: null, last: null };

/** ブリーフィングジョブを起動する。すでに実行中なら false を返す。 */
export function runBriefing(): boolean {
  if (job.running) return false;
  const startedAt = new Date().toISOString();
  const child = spawn(BRIEFING_SCRIPT, [], { stdio: 'ignore' });
  job.running = { startedAt, pid: child.pid };
  child.on('error', (e) => {
    console.error(`briefing ジョブの起動に失敗: ${e.message}`);
    job.running = null;
    job.last = { startedAt, endedAt: new Date().toISOString(), exitCode: null };
  });
  child.on('exit', (code) => {
    console.log(`briefing ジョブ終了 (exit=${code})`);
    job.running = null;
    job.last = { startedAt, endedAt: new Date().toISOString(), exitCode: code };
  });
  return true;
}

/** logs/ の最新 briefing-*.log の名前と末尾を返す（無ければ null）。 */
function latestLogTail(): { file: string; tail: string } | null {
  let names: string[];
  try {
    names = fs.readdirSync(LOG_DIR).filter((n) => /^briefing-.*\.log$/.test(n));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const file = names.sort().at(-1)!; // ファイル名が briefing-<日時> なので辞書順 = 時系列
  const full = path.join(LOG_DIR, file);
  try {
    const { size } = fs.statSync(full);
    const fd = fs.openSync(full, 'r');
    try {
      const start = Math.max(0, size - LOG_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return { file, tail: buf.toString('utf8') };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export interface AdminCalendar {
  id: string;
  summary: string;
  primary: boolean;
  selected: boolean;
}

/** Google アカウントの全カレンダーに収集対象フラグを付けて返す（GET /admin/calendars）。 */
export async function listCalendars(): Promise<AdminCalendar[]> {
  const cal = calendarClient();
  const selected = new Set(resolveCalendarIds());
  const items: AdminCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.calendarList.list({ maxResults: 250, pageToken });
    for (const c of res.data.items ?? []) {
      if (!c.id) continue;
      items.push({
        id: c.id,
        summary: c.summaryOverride ?? c.summary ?? c.id,
        primary: c.primary === true,
        // .env 既定の別名 'primary' は実 ID（メールアドレス）の primary カレンダーを指す
        selected: selected.has(c.id) || (c.primary === true && selected.has('primary')),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  items.sort((a, b) =>
    a.primary !== b.primary ? (a.primary ? -1 : 1) : a.summary.localeCompare(b.summary, 'ja'),
  );
  return items;
}

/** 収集対象カレンダーを保存する（PUT /admin/calendars）。 */
export function updateCalendars(ids: string[]): void {
  saveCalendarIds(ids);
}

/** AI 利用状況の詳細（GET /admin/ai-usage）。 */
export function getAiUsage(): unknown {
  return {
    configuredModel: config.llm.model,
    summary: llmUsageSummary(),
    monthly: monthlyLlmUsage(12),
    recent: recentLlmUsage(20),
  };
}

/** 管理画面に出す状態のスナップショット（GET /admin/status）。 */
export function getStatus(): unknown {
  const briefing = latestBriefing();
  const usage = llmUsageSummary();
  return {
    now: new Date().toISOString(),
    job,
    aiUsage: { monthCostUsd: usage.monthCostUsd, monthCalls: usage.monthCalls },
    briefing: briefing
      ? {
          id: briefing.id,
          date: briefing.briefing_date,
          title: briefing.title,
          summary: briefing.summary,
          createdAt: briefing.created_at,
          pushedAt: briefing.pushed_at,
        }
      : null,
    devices: listDevices().map((d) => ({
      id: d.id,
      token: `${d.token.slice(0, 8)}…`,
      platform: d.platform,
      updatedAt: d.updated_at,
    })),
    collectorRuns: recentCollectorRuns(10),
    pushLogs: recentPushLogs(10),
    log: latestLogTail(),
  };
}
