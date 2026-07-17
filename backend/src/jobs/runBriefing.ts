// `npm run briefing` — 収集 → LLM 生成 → SQLite 保存 → APNs push を 1 回実行する（cron から呼ぶ本体）。
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { closeDb } from '../db/index.js';
import {
  cleanupDeadlineCompletions,
  insertBriefing,
  insertCollectorRun,
  insertLlmUsage,
  listCompletedDeadlineUids,
} from '../db/repo.js';
import { collectAll } from '../collectors/all.js';
import { generateBriefing } from '../llm/briefing.js';
import { pushBriefingToDevices } from '../push/briefingPush.js';
import { briefingDate } from '../util/time.js';
import type { CollectedInput, DeadlineItem } from '../types.js';

/** 完了行を掃除するまでの日数（フィードは過去の課題を含み続けるため期日基準で消す） */
const COMPLETION_RETENTION_DAYS = 60;

/**
 * 手動完了済みの uid を締切一覧へ反映する。
 * annotated = completed フラグ付き全件（payload 保存用）/ active = 未完了のみ（LLM 入力用）。
 */
export function applyDeadlineCompletions(
  deadlines: DeadlineItem[],
  completedUids: Set<string>,
): { annotated: DeadlineItem[]; active: DeadlineItem[] } {
  const annotated = deadlines.map((d) =>
    d.uid && completedUids.has(d.uid) ? { ...d, completed: true } : d,
  );
  return { annotated, active: annotated.filter((d) => !d.completed) };
}

/**
 * コレクタごとの実行結果を collector_runs 用に組み立てる。
 * warnings は collectAll の「[名前] メッセージ」形式（名前は下表の warnPrefix）。
 */
export function collectorRunsFrom(
  input: CollectedInput,
  warnings: string[],
): { source: string; status: 'ok' | 'error'; rawJson: string; error?: string }[] {
  const sources: { source: string; warnPrefix: string; raw: unknown }[] = [
    {
      source: 'calendar',
      warnPrefix: '[Calendar]',
      raw: {
        events: input.todayEvents,
        deadlines: input.deadlines.filter((d) => d.source === 'calendar'),
      },
    },
    {
      source: 'canvas',
      warnPrefix: '[Canvas]',
      raw: input.deadlines.filter((d) => d.source === 'canvas'),
    },
    { source: 'gmail', warnPrefix: '[Gmail]', raw: input.mailCandidates },
    { source: 'github', warnPrefix: '[GitHub]', raw: input.github },
    { source: 'todos', warnPrefix: '[TODO]', raw: input.todos },
  ];
  return sources.map(({ source, warnPrefix, raw }) => {
    const warning = warnings.find((w) => w.startsWith(warnPrefix));
    return {
      source,
      status: warning ? ('error' as const) : ('ok' as const),
      rawJson: JSON.stringify(raw),
      error: warning?.slice(warnPrefix.length + 1),
    };
  });
}

async function main(): Promise<void> {
  const now = new Date();
  console.log(`=== 朝ブリーフィング生成: ${now.toISOString()} ===`);

  const { input, warnings } = await collectAll(now);
  for (const w of warnings) console.warn(`⚠ ${w}`);
  console.log(
    `収集: 予定 ${input.todayEvents.length} / 締切 ${input.deadlines.length} / ` +
      `TODO ${input.todos.length} / GitHub ${input.github.length} / メール候補 ${input.mailCandidates.length}`,
  );

  for (const run of collectorRunsFrom(input, warnings)) {
    insertCollectorRun({ briefingDate: input.date, ...run });
  }

  // 手動完了済みの締切は LLM 入力（= 通知文面）から除外し、payload には全件フラグ付きで残す
  cleanupDeadlineCompletions(
    briefingDate(new Date(now.getTime() - COMPLETION_RETENTION_DAYS * 86_400_000), config.briefing.tz),
  );
  const completedUids = new Set(listCompletedDeadlineUids());
  const { annotated, active } = applyDeadlineCompletions(input.deadlines, completedUids);
  if (active.length !== annotated.length) {
    console.log(`締切 ${annotated.length} 件中 ${annotated.length - active.length} 件は完了済み（LLM 入力から除外）`);
  }

  const briefing = await generateBriefing({ ...input, deadlines: active });
  briefing.payload.deadlines = annotated;
  insertLlmUsage({ briefingDate: input.date, purpose: 'briefing', ...briefing.usage });
  console.log(
    `LLM: ${briefing.usage.model} 入力 ${briefing.usage.inputTokens} / 出力 ${briefing.usage.outputTokens} トークン` +
      (briefing.usage.costUsd != null ? ` ($${briefing.usage.costUsd.toFixed(4)})` : ''),
  );
  const payloadJson = JSON.stringify(briefing.payload);
  const id = insertBriefing({
    briefingDate: input.date,
    lang: briefing.payload.lang,
    title: briefing.title,
    summary: briefing.summary,
    payloadJson,
  });

  console.log(`保存: briefings.id=${id} (${input.date})`);
  console.log(`  title  : ${briefing.title}`);
  console.log(`  summary: ${briefing.summary}`);

  const push = await pushBriefingToDevices({
    id,
    briefing_date: input.date,
    title: briefing.title,
    summary: briefing.summary,
    payload_json: payloadJson,
  });
  for (const m of push.messages) console.log(push.attempted ? `  ${m}` : `⚠ ${m}`);
  if (push.attempted) {
    console.log(`push: 送信 ${push.sent} / 失敗 ${push.failed}`);
    // 全デバイスへ送信失敗した朝は cron 監視で気付けるよう異常終了にする
    if (push.sent === 0) process.exitCode = 1;
  }
}

// 直接実行されたときだけ main を走らせる（collectorRunsFrom の import ではジョブを起動しない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => {
      console.error(`ブリーフィング生成に失敗しました: ${(e as Error).message}`);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
