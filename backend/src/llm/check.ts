// `npm run llm:check` — LLM 層（トリアージ + 日本語ブリーフィング生成）の動作確認。
// .env に ANTHROPIC_API_KEY が必要。
//   npm run llm:check               … 全コレクタで実データを収集して生成
//   npm run llm:check -- --fixture  … 固定のサンプル入力で生成（Google/Canvas 等の認証不要）
import { config } from '../config.js';
import { briefingDate } from '../util/time.js';
import { collectAll } from '../collectors/all.js';
import { generateBriefing } from './briefing.js';
import type { CollectedInput } from '../types.js';

/** トリアージ 4 区分（要対応/参考/無視/除外）を網羅するサンプル入力。 */
function fixtureInput(now: Date): CollectedInput {
  const date = briefingDate(now, config.briefing.tz);
  const iso = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();
  return {
    date,
    todayEvents: [
      { title: 'ESL クラス', startAt: iso(3), endAt: iso(5), location: 'Shoreline CC' },
    ],
    deadlines: [
      { source: 'canvas', title: 'Unit 3 Essay Draft', dueAt: iso(30), course: 'ESLAF 063' },
      { source: 'calendar', title: '保険の更新', dueAt: date },
    ],
    todos: [
      { repo: 'ai-secretary', text: 'MVP Step 5: API + SQLite 保存' },
      { repo: 'vibeboard', text: 'カスタムタブのサンプル整備' },
    ],
    github: [
      { repo: 'akiraak/ai-secretary', kind: 'commit', title: 'MVP Step 3.5: GitHub コレクタを追加' },
      { repo: 'akiraak/ai-secretary', kind: 'pr', title: 'PR #12 をマージ: Canvas コレクタ' },
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
  console.log('\n【payload JSON】');
  console.log(JSON.stringify(briefing.payload, null, 2));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
