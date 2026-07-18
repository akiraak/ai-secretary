// `npm run briefing` — 収集 → LLM 生成 → SQLite 保存 → APNs push を 1 回実行する（cron から呼ぶ本体）。
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { closeDb } from '../db/index.js';
import {
  cleanupDeadlineCompletions,
  getRepoSummaryCache,
  getTodoSummaryCache,
  insertBriefing,
  insertCollectorRun,
  insertLlmUsage,
  listCompletedDeadlineUids,
  saveRepoSummaryCache,
  saveTodoSummaryCache,
} from '../db/repo.js';
import { collectAll } from '../collectors/all.js';
import { annotateChanges, detectCalendarChanges } from './calendarDiff.js';
import { generateBriefing } from '../llm/briefing.js';
import { generateRepoSummary, hashRepoCommits } from '../llm/repoSummary.js';
import { generateTodoSummary, hashTodos } from '../llm/todoSummary.js';
import { pushBriefingToDevices } from '../push/briefingPush.js';
import { briefingDate } from '../util/time.js';
import type {
  CollectedInput,
  DeadlineItem,
  RepoOverview,
  TodoItem,
  TodoRepoSummary,
} from '../types.js';

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
 * リポジトリごとに TODO サマリーを取得する（並びは todos の初出順 = GITHUB_REPOS の設定順）。
 * リポジトリの TODO 内容が前回と同一ならキャッシュを返し LLM を呼ばない。
 * 生成失敗はブリーフィング全体を止めず、そのリポジトリを結果から外す
 * （iOS 側は件数のみ表示にフォールバック）。
 */
export async function resolveTodoSummaries(
  todos: TodoItem[],
  date: string,
): Promise<TodoRepoSummary[] | undefined> {
  const byRepo = new Map<string, TodoItem[]>();
  for (const t of todos) {
    const list = byRepo.get(t.repo);
    if (list) list.push(t);
    else byRepo.set(t.repo, [t]);
  }

  const results: TodoRepoSummary[] = [];
  for (const [repo, items] of byRepo) {
    const hash = hashTodos(items);
    const cached = getTodoSummaryCache(hash);
    if (cached !== undefined) {
      console.log(`TODO サマリー (${repo}): 前回から変更なし（キャッシュ使用・LLM 呼び出しなし）`);
      results.push({ repo, summary: cached });
      continue;
    }
    try {
      const { summary, usage } = await generateTodoSummary(repo, items);
      insertLlmUsage({ briefingDate: date, purpose: 'todo_summary', ...usage });
      saveTodoSummaryCache(hash, summary);
      console.log(
        `TODO サマリー生成 (${repo}): ${usage.model} 入力 ${usage.inputTokens} / 出力 ${usage.outputTokens} トークン` +
          (usage.costUsd != null ? ` ($${usage.costUsd.toFixed(4)})` : ''),
      );
      results.push({ repo, summary });
    } catch (e) {
      console.warn(`⚠ TODO サマリー生成に失敗しました (${repo}): ${(e as Error).message}`);
    }
  }
  return results.length > 0 ? results : undefined;
}

/**
 * リポジトリごとに直近作業サマリーを取得する（GitHub タブ用）。
 * そのリポジトリのコミット一覧が前回と同一（= push 無し）ならキャッシュを返し LLM を呼ばない。
 * 生成失敗はブリーフィング全体を止めず、そのリポジトリの recentSummary 無しで続行する
 * （iOS 側はコミット一覧のみ表示にフォールバック）。コミット 0 件のリポジトリはスキップ。
 */
export async function resolveRepoSummaries(
  overviews: RepoOverview[] | undefined,
  date: string,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  for (const o of overviews ?? []) {
    if (o.commits.length === 0) continue;
    const hash = hashRepoCommits(o.repo, o.commits);
    const cached = getRepoSummaryCache(hash);
    if (cached !== undefined) {
      console.log(`直近作業サマリー (${o.repo}): 前回から変更なし（キャッシュ使用・LLM 呼び出しなし）`);
      results.set(o.repo, cached);
      continue;
    }
    try {
      const { summary, usage } = await generateRepoSummary(o.repo, o.commits);
      insertLlmUsage({ briefingDate: date, purpose: 'repo_summary', ...usage });
      saveRepoSummaryCache(hash, summary);
      console.log(
        `直近作業サマリー生成 (${o.repo}): ${usage.model} 入力 ${usage.inputTokens} / 出力 ${usage.outputTokens} トークン` +
          (usage.costUsd != null ? ` ($${usage.costUsd.toFixed(4)})` : ''),
      );
      results.set(o.repo, summary);
    } catch (e) {
      console.warn(`⚠ 直近作業サマリー生成に失敗しました (${o.repo}): ${(e as Error).message}`);
    }
  }
  return results;
}

/**
 * payload.repos を組み立てる: リポジトリ一覧に直近作業サマリーと TODO 系フィールドを join する。
 * todos 側のラベルはリモートが `owner/repo`・ローカルパスが basename なので、
 * 完全一致 → name 部分一致の順で解決し、iOS はここで確定した todoRepo で payload.todos を引くだけにする。
 */
export function buildRepoPayload(
  overviews: RepoOverview[] | undefined,
  recentSummaries: Map<string, string>,
  todos: TodoItem[],
  todoSummaries: TodoRepoSummary[] | undefined,
): RepoOverview[] | undefined {
  if (!overviews) return undefined;
  const todoCounts = new Map<string, number>();
  for (const t of todos) todoCounts.set(t.repo, (todoCounts.get(t.repo) ?? 0) + 1);
  const labels = [...todoCounts.keys()];
  return overviews.map((o) => {
    const name = o.repo.split('/')[1] ?? o.repo;
    const todoRepo = labels.find((l) => l === o.repo) ?? labels.find((l) => l === name);
    return {
      ...o,
      recentSummary: recentSummaries.get(o.repo),
      todoRepo,
      todoSummary: todoRepo
        ? todoSummaries?.find((s) => s.repo === todoRepo)?.summary
        : undefined,
      todoCount: todoRepo ? (todoCounts.get(todoRepo) ?? 0) : 0,
    };
  });
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
        events: input.events,
        todayEvents: input.todayEvents,
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
    { source: 'github_repos', warnPrefix: '[GitHubRepos]', raw: input.repoOverviews ?? [] },
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
    `収集: 予定 ${input.events.length}（今日 ${input.todayEvents.length}） / 締切 ${input.deadlines.length} / ` +
      `TODO ${input.todos.length} / GitHub ${input.github.length} / リポジトリ ${input.repoOverviews?.length ?? 0} / ` +
      `メール候補 ${input.mailCandidates.length}`,
  );

  for (const run of collectorRunsFrom(input, warnings)) {
    insertCollectorRun({ briefingDate: input.date, ...run });
  }

  // 前回ブリーフィング以降のカレンダー変更を検出し、events / deadlines に changed を付与する。
  // 失敗したコレクタのソースは差分・スナップショット更新ともスキップ（全件「削除」の誤検知防止）
  const diff = detectCalendarChanges({
    events: input.events,
    deadlines: input.deadlines,
    sources: {
      calendar: !warnings.some((w) => w.startsWith('[Calendar]')),
      canvas: !warnings.some((w) => w.startsWith('[Canvas]')),
    },
    now,
  });
  annotateChanges(input, diff.changedKeys);
  input.calendarChanges = diff.changes;
  const kindCount = (kind: string) => diff.changes.filter((c) => c.kind === kind).length;
  console.log(
    `カレンダー変更: 新規 ${kindCount('new')} / 変更 ${kindCount('updated')} / 削除 ${kindCount('removed')}`,
  );

  // 手動完了済みの締切は LLM 入力（= 通知文面）から除外し、payload には全件フラグ付きで残す
  cleanupDeadlineCompletions(
    briefingDate(new Date(now.getTime() - COMPLETION_RETENTION_DAYS * 86_400_000), config.briefing.tz),
  );
  const completedUids = new Set(listCompletedDeadlineUids());
  const { annotated, active } = applyDeadlineCompletions(input.deadlines, completedUids);
  if (active.length !== annotated.length) {
    console.log(`締切 ${annotated.length} 件中 ${annotated.length - active.length} 件は完了済み（LLM 入力から除外）`);
  }

  const todoSummaries = await resolveTodoSummaries(input.todos, input.date);
  const repoSummaries = await resolveRepoSummaries(input.repoOverviews, input.date);

  const briefing = await generateBriefing({ ...input, deadlines: active });
  briefing.payload.deadlines = annotated;
  briefing.payload.todoSummaries = todoSummaries;
  briefing.payload.repos = buildRepoPayload(
    input.repoOverviews,
    repoSummaries,
    input.todos,
    todoSummaries,
  );
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
