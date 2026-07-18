// 全コレクタをまとめて実行し、LLM 層への入力 (CollectedInput) を組み立てる。
// 一部のコレクタが失敗（未設定・ネットワークエラー等）してもブリーフィング自体は
// 生成できるよう、失敗は warnings に落として空リストで続行する。
import { config } from '../config.js';
import { briefingDate } from '../util/time.js';
import type { CollectedInput, RepoOverview } from '../types.js';
import { collectCalendar } from './calendar.js';
import { collectCanvas } from './canvas.js';
import { collectGithub, collectRepoOverviews } from './github.js';
import { collectGmail } from './gmail.js';
import { collectTodos } from './todos.js';

export interface CollectResult {
  input: CollectedInput;
  /** 失敗したコレクタの「[名前] メッセージ」一覧 */
  warnings: string[];
}

/** now 時点のブリーフィング入力を全コレクタから収集する。 */
export async function collectAll(now: Date): Promise<CollectResult> {
  const warnings: string[] = [];
  const safe = async <T>(name: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      warnings.push(`[${name}] ${(e as Error).message}`);
      return fallback;
    }
  };

  // repoOverviews は失敗時 undefined のまま（payload.repos を出さず iOS が旧表示にフォールバックする）
  const [calendar, canvasDeadlines, mailCandidates, github, todos, repoOverviews] =
    await Promise.all([
      safe('Calendar', { events: [], todayEvents: [], deadlines: [] }, () => collectCalendar(now)),
      safe('Canvas', [], () => collectCanvas(now)),
      safe('Gmail', [], () => collectGmail()),
      safe('GitHub', [], () => collectGithub(now)),
      safe('TODO', [], () => collectTodos()),
      safe<RepoOverview[] | undefined>('GitHubRepos', undefined, () => collectRepoOverviews(now)),
    ]);

  // 締切は Canvas + Calendar 終日イベント由来をマージして期日順に。
  // dueAt は ISO8601 か YYYY-MM-DD（日付のみ）なので文字列比較で時系列順になる。
  const deadlines = [...canvasDeadlines, ...calendar.deadlines].sort((a, b) =>
    a.dueAt.localeCompare(b.dueAt),
  );

  return {
    input: {
      date: briefingDate(now, config.briefing.tz),
      events: calendar.events,
      todayEvents: calendar.todayEvents,
      deadlines,
      todos,
      github,
      mailCandidates,
      repoOverviews,
    },
    warnings,
  };
}
