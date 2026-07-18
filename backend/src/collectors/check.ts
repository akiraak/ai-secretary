// `npm run collectors:check` — Calendar / Gmail / Canvas / GitHub / TODO コレクタが実データを取得できるか確認する。
// .env に GOOGLE_* が設定済みで、`npm run google:auth` でリフレッシュトークンを取得済みであること。
// Canvas は CANVAS_ICAL_URL、GitHub は GITHUB_TOKEN（または gh CLI ログイン）、
// TODO は GITHUB_REPOS の設定が必要。
import { config } from '../config.js';
import { briefingDate } from '../util/time.js';
import { collectCalendar } from './calendar.js';
import { collectCanvas } from './canvas.js';
import { collectGithub, collectRepoOverviews } from './github.js';
import { collectGmail } from './gmail.js';
import { collectTodos } from './todos.js';

async function main(): Promise<void> {
  const now = new Date();
  const tz = config.briefing.tz;
  console.log(`ブリーフィング日付: ${briefingDate(now, tz)} (${tz})\n`);

  // --- Calendar ---
  try {
    const { events, todayEvents, deadlines } = await collectCalendar(now);
    console.log(
      `[Calendar] 予定 ${events.length} 件（今後 ${config.google.calendarLookaheadDays} 日 / ` +
        `今日 ${todayEvents.length} 件） / 締切(終日) ${deadlines.length} 件`,
    );
    for (const e of events) {
      const t = new Date(e.startAt).toLocaleString('ja-JP', { timeZone: tz });
      console.log(`  ・${t}  ${e.title}${e.location ? ` @${e.location}` : ''}`);
    }
    for (const d of deadlines) {
      console.log(`  ⏰ ${d.dueAt}  ${d.title} (${d.course ?? ''})`);
    }
  } catch (e) {
    console.error('[Calendar] 失敗:', (e as Error).message);
  }

  console.log('');

  // --- Gmail ---
  try {
    const mails = await collectGmail();
    console.log(`[Gmail] 受信候補 ${mails.length} 件（直近 ${config.gmail.lookbackDays} 日）`);
    for (const m of mails) {
      console.log(`  ・${m.from}`);
      console.log(`    ${m.subject}`);
      console.log(`    ${m.snippet.slice(0, 80)}`);
    }
  } catch (e) {
    console.error('[Gmail] 失敗:', (e as Error).message);
  }

  console.log('');

  // --- Canvas ---
  try {
    const deadlines = await collectCanvas(now);
    console.log(`[Canvas] 締切 ${deadlines.length} 件（今後 ${config.canvas.lookaheadDays} 日）`);
    for (const d of deadlines) {
      const due =
        d.dueAt.length === 10 // YYYY-MM-DD（日付のみ）はそのまま表示
          ? d.dueAt
          : new Date(d.dueAt).toLocaleString('ja-JP', { timeZone: tz });
      console.log(`  ⏰ ${due}  ${d.title}${d.course ? ` (${d.course})` : ''}`);
    }
  } catch (e) {
    console.error('[Canvas] 失敗:', (e as Error).message);
  }

  console.log('');

  // --- GitHub ---
  try {
    const items = await collectGithub(now);
    console.log(`[GitHub] 昨日の活動 ${items.length} 件`);
    for (const g of items) {
      console.log(`  ・${g.kind === 'commit' ? '🔨' : '🔀'} ${g.repo}  ${g.title}`);
    }
  } catch (e) {
    console.error('[GitHub] 失敗:', (e as Error).message);
  }

  console.log('');

  // --- GitHub リポジトリ一覧 ---
  try {
    const overviews = await collectRepoOverviews(now);
    console.log(`[GitHubRepos] 更新順リポジトリ ${overviews.length} 件（直近 90 日 / 最大 20 件）`);
    for (const r of overviews) {
      const pushed = new Date(r.pushedAt).toLocaleString('ja-JP', { timeZone: tz });
      console.log(`  ・${r.repo}  push: ${pushed}  コミット ${r.commits.length} 件`);
    }
  } catch (e) {
    console.error('[GitHubRepos] 失敗:', (e as Error).message);
  }

  console.log('');

  // --- TODO.md ---
  try {
    const todos = await collectTodos();
    console.log(
      `[TODO] 未完了タスク ${todos.length} 件（${new Set(todos.map((t) => t.repo)).size} リポジトリ）`,
    );
    for (const t of todos) {
      console.log(`  ・${t.repo}: ${t.text}`);
    }
  } catch (e) {
    console.error('[TODO] 失敗:', (e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
