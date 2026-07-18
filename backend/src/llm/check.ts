// `npm run llm:check` — LLM 層（トリアージ + 日本語ブリーフィング生成）の動作確認。
// .env に ANTHROPIC_API_KEY が必要。
//   npm run llm:check               … 全コレクタで実データを収集して生成
//   npm run llm:check -- --fixture  … 固定のサンプル入力で生成（Google/Canvas 等の認証不要）
import { config } from '../config.js';
import { briefingDate } from '../util/time.js';
import { collectAll } from '../collectors/all.js';
import { generateBriefing } from './briefing.js';
import { generateRepoSummary } from './repoSummary.js';
import { generateTodoSummary } from './todoSummary.js';
import type { CollectedInput } from '../types.js';

/** トリアージ 4 区分（要対応/参考/無視/除外）を網羅するサンプル入力。 */
function fixtureInput(now: Date): CollectedInput {
  const date = briefingDate(now, config.briefing.tz);
  const iso = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();
  return {
    date,
    events: [
      { id: 'ev1', title: 'ESL クラス', startAt: iso(3), endAt: iso(5), location: 'Shoreline CC' },
      { id: 'ev2', title: '歯科検診', startAt: iso(75), endAt: iso(76), changed: 'updated' },
    ],
    todayEvents: [
      { id: 'ev1', title: 'ESL クラス', startAt: iso(3), endAt: iso(5), location: 'Shoreline CC' },
    ],
    deadlines: [
      { source: 'canvas', title: 'Unit 3 Essay Draft', dueAt: iso(30), course: 'ESLAF 063', changed: 'new' },
      { source: 'calendar', title: '保険の更新', dueAt: date },
    ],
    calendarChanges: [
      { kind: 'new', source: 'canvas', title: 'Unit 3 Essay Draft', detail: '7/18(土) 23:59' },
      { kind: 'updated', source: 'calendar', title: '歯科検診', detail: '7/19(日) 14:00 → 7/20(月) 10:00' },
      { kind: 'removed', source: 'calendar', title: 'チームランチ', detail: '7/22(水) 12:00' },
    ],
    todos: [
      { repo: 'ai-secretary', text: 'MVP Step 5: API + SQLite 保存' },
      { repo: 'vibeboard', text: 'カスタムタブのサンプル整備' },
    ],
    github: [
      { repo: 'akiraak/ai-secretary', kind: 'commit', title: 'MVP Step 3.5: GitHub コレクタを追加' },
      { repo: 'akiraak/ai-secretary', kind: 'pr', title: 'PR #12 をマージ: Canvas コレクタ' },
    ],
    repoOverviews: [
      {
        repo: 'akiraak/ai-secretary',
        url: 'https://github.com/akiraak/ai-secretary',
        pushedAt: iso(-1),
        commits: [
          { message: 'GitHub タブ拡充 Phase 1: 更新順リポジトリ一覧コレクタを追加', date: iso(-1) },
          { message: 'TODO サマリーをリポジトリごとに変更: 生成・キャッシュ・payload・HOME 表示', date: iso(-26) },
          { message: 'HOME「今日やる」を「GitHub」セクションへ変更', date: iso(-30) },
        ],
        todoCount: 0,
      },
      {
        repo: 'akiraak/vibeboard',
        url: 'https://github.com/akiraak/vibeboard',
        pushedAt: iso(-50),
        commits: [{ message: 'Root タブの楽観ロック（mtime チェック）を追加', date: iso(-50) }],
        todoCount: 0,
      },
    ],
    mailCandidates: [
      {
        id: 'm1',
        threadId: 't1',
        from: 'Google One <noreply@google.com>',
        subject: 'Google One のお支払いが完了できませんでした',
        snippet: 'お支払い方法を更新してください。更新されない場合、ストレージが制限されます。',
        date: iso(-2),
        labelIds: ['INBOX'],
        gmailLink: 'https://mail.google.com/mail/u/0/#inbox/t1',
      },
      {
        id: 'm2',
        threadId: 't2',
        from: 'Shoreline Navigate <navigate@shoreline.edu>',
        subject: 'Action Required: Fall Quarter Enrollment',
        snippet: 'Please complete your enrollment verification by Friday.',
        date: iso(-5),
        labelIds: ['INBOX'],
        gmailLink: 'https://mail.google.com/mail/u/0/#inbox/t2',
      },
      {
        id: 'm3',
        threadId: 't3',
        from: 'Instructure Canvas <notifications@instructure.com>',
        subject: '採点結果: Unit 2 Presentation',
        snippet: 'Your submission has been graded: 95/100.',
        date: iso(-8),
        labelIds: ['INBOX'],
        gmailLink: 'https://mail.google.com/mail/u/0/#inbox/t3',
      },
      {
        id: 'm4',
        threadId: 't4',
        from: 'Amazon.com <store-news@amazon.com>',
        subject: '本日のタイムセール: 最大40%オフ',
        snippet: '今日だけのお得なセールをお見逃しなく。',
        date: iso(-10),
        labelIds: ['INBOX'],
        gmailLink: 'https://mail.google.com/mail/u/0/#inbox/t4',
      },
      {
        id: 'm5',
        threadId: 't5',
        from: 'Akira Kozakai <akiraak@gmail.com>',
        subject: '[Autopilot] デイリーレポート 2026-07-14',
        snippet: '本日の自動処理結果をお知らせします。',
        date: iso(-12),
        labelIds: ['INBOX'],
        gmailLink: 'https://mail.google.com/mail/u/0/#inbox/t5',
      },
      {
        // アーカイブ済み（INBOX ラベルなし）の返信待ち個人メール。
        // 実アカウントは受信メールが即アーカイブされるため、この形の候補が主になる
        id: 'm6',
        threadId: 't6',
        from: 'Mike Tanaka <mike.tanaka@example.com>',
        subject: '来週の勉強会、参加できますか？',
        snippet: '候補日は 7/22(水) か 7/24(金) です。都合の良い日を返信してもらえると助かります。',
        date: iso(-6),
        labelIds: ['IMPORTANT'],
        gmailLink: 'https://mail.google.com/mail/u/0/#all/t6',
      },
    ],
  };
}

async function main(): Promise<void> {
  const useFixture = process.argv.includes('--fixture');
  const now = new Date();

  let input: CollectedInput;
  if (useFixture) {
    console.log('=== フィクスチャ入力で LLM 層を検証 ===\n');
    input = fixtureInput(now);
  } else {
    console.log('=== 実データを収集して LLM 層を検証 ===\n');
    const { input: collected, warnings } = await collectAll(now);
    for (const w of warnings) console.warn(`⚠ ${w}`);
    input = collected;
  }

  console.log(
    `入力: 予定 ${input.todayEvents.length} / 締切 ${input.deadlines.length} / ` +
      `TODO ${input.todos.length} / GitHub ${input.github.length} / メール候補 ${input.mailCandidates.length}\n`,
  );

  console.log(`モデル: ${config.llm.model}`);
  const started = Date.now();
  const briefing = await generateBriefing(input);
  console.log(`生成時間: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const u = briefing.usage;
  console.log(
    `usage: ${u.model} 入力 ${u.inputTokens} / 出力 ${u.outputTokens}` +
      ` / キャッシュ書込 ${u.cacheCreationInputTokens} / 読取 ${u.cacheReadInputTokens} トークン` +
      (u.costUsd != null ? ` = $${u.costUsd.toFixed(4)}` : ' (単価不明)') +
      '\n',
  );

  console.log(`【title】\n${briefing.title}\n`);
  console.log(`【summary】\n${briefing.summary}\n`);
  console.log(`【メールトリアージ】(${briefing.payload.mails.length}件が要対応/参考)`);
  for (const m of briefing.payload.mails) {
    console.log(`  ${m.priority === 'action' ? '🔴 要対応' : '🔵 参考  '} ${m.subject}`);
    console.log(`           ${m.from} — ${m.reason}`);
  }
  // HOME「GitHub」セクション用のリポジトリ別 TODO サマリー
  // （キャッシュ判定は runBriefing 側なのでここでは生成のみ）
  if (input.todos.length > 0) {
    console.log('\n【TODO サマリー（リポジトリ別）】');
    for (const repo of [...new Set(input.todos.map((t) => t.repo))]) {
      const items = input.todos.filter((t) => t.repo === repo);
      const ts = await generateTodoSummary(repo, items);
      console.log(
        `- ${repo} (${items.length}件, 入力 ${ts.usage.inputTokens} / 出力 ${ts.usage.outputTokens} トークン` +
          (ts.usage.costUsd != null ? ` = $${ts.usage.costUsd.toFixed(4)}` : '') +
          `)\n  ${ts.summary}`,
      );
    }
  }

  // GitHub タブ用の直近作業サマリー（キャッシュ判定は runBriefing 側なのでここでは生成のみ。
  // 実データは最大 20 リポジトリあるためコスト節約で先頭 3 件に絞る）
  const overviews = (input.repoOverviews ?? []).filter((r) => r.commits.length > 0);
  const summaryTargets = useFixture ? overviews : overviews.slice(0, 3);
  if (summaryTargets.length > 0) {
    console.log('\n【直近作業サマリー（リポジトリ別）】');
    if (summaryTargets.length < overviews.length) {
      console.log(`（実データ ${overviews.length} 件中、先頭 ${summaryTargets.length} 件のみ生成）`);
    }
    for (const r of summaryTargets) {
      const rs = await generateRepoSummary(r.repo, r.commits);
      console.log(
        `- ${r.repo} (コミット ${r.commits.length}件, 入力 ${rs.usage.inputTokens} / 出力 ${rs.usage.outputTokens} トークン` +
          (rs.usage.costUsd != null ? ` = $${rs.usage.costUsd.toFixed(4)}` : '') +
          `)\n  ${rs.summary}`,
      );
    }
  }

  console.log('\n【payload JSON】');
  console.log(JSON.stringify(briefing.payload, null, 2));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
