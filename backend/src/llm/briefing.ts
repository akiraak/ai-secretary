// LLM 層: 収集結果を Claude（既定 claude-haiku-4-5）で日本語ブリーフィングに整形する。
// - メールのトリアージ（要対応 / 参考 / 無視 / 除外）は spec 1-2 の初期ルールをプロンプトに埋め込む
// - 出力は構造化出力（output_config.format の JSON Schema）で固定し、パース失敗をなくす
// - LLM には from/subject 等を写させず index だけ返させ、MailItem への復元はコード側で行う
//   （ハルシネーションでメタデータが化けるのを防ぐ）
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { usageFromResponse, type LlmUsage } from './pricing.js';
import type { BriefingPayload, CollectedInput, MailItem } from '../types.js';

export interface GeneratedBriefing {
  /** push 通知タイトル（briefings.title） */
  title: string;
  /** push 通知本文 / ブリーフィング冒頭の要約（briefings.summary） */
  summary: string;
  /** briefings.payload_json に保存する構造化データ */
  payload: BriefingPayload;
  /** API 呼び出しのトークン数とコスト（llm_usage への保存は呼び出し側が行う） */
  usage: LlmUsage;
}

/** LLM が返すメールトリアージ 1 件（index は mailCandidates の添字） */
export interface MailTriageEntry {
  index: number;
  priority: 'action' | 'info';
  reason: string;
}

interface ModelOutput {
  title: string;
  summary: string;
  mails: MailTriageEntry[];
}

// トリアージ基準は docs/specs/app-features.md 1-2 の実データ分析に基づく初期ルール。
const SYSTEM_PROMPT = `あなたは Akira Kozakai のパーソナル秘書です。毎朝の日本語ブリーフィングを作成します。
入力（今日の予定・締切・TODO・昨日の GitHub 活動・受信メール候補）をもとに、以下を出力してください。

# 1. メールのトリアージ (mails)
受信メール候補を次の基準で分類し、「要対応 (action)」と「参考 (info)」だけを mails に含めます。
- 要対応 (action): サブスクリプション期限（Google One 等）、銀行・支払い、学校事務（navigate@shoreline.edu 等）、セキュリティ警告（パスワード漏洩等）
- 参考 (info): Canvas の採点結果、Amazon の配送状況 など「知っておけばよい」通知
- 無視（mails に含めない）: プロモーション（Amazon store-news、NordVPN 等）、ニュースレター（NYT、Mackerel、note 等）
- 除外（mails に含めない）: 自分宛ての自動送信（Autopilot ニュース、[Autopilot] レポート、セルフメモ）
index には候補リストの [n] の番号をそのまま入れ、reason には分類理由を日本語で簡潔に（20字程度）書きます。

# 2. title
push 通知のタイトル。「M/D(曜) 朝ブリーフィング」に、最重要トピックがあれば「 — 」で 1 つ添える。
例: 「7/15(火) 朝ブリーフィング — Canvas 締切あり」

# 3. summary
push 通知の本文になる 2〜4 文の日本語要約。締切・今日の予定・要対応メールのうち重要なものに件数とともに触れる。
「カレンダーの変更」に項目があれば、件数と重要な変更内容（例: 「◯◯が7/21に変更」「新しい予定 2 件」）に必ず触れる。
無ければ変更には触れない。
入力に存在しない情報は決して書かない。項目が全て空なら「今日は特に予定・締切・要対応メールはありません。」とする。`;

// 構造化出力スキーマ。全オブジェクトに additionalProperties: false が必須。
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'push 通知タイトル' },
    summary: { type: 'string', description: '2〜4文の日本語要約' },
    mails: {
      type: 'array',
      description: '要対応/参考と判定したメールだけを含める',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: '候補リストの [n] の番号' },
          priority: { type: 'string', enum: ['action', 'info'] },
          reason: { type: 'string', description: '分類理由（日本語で簡潔に）' },
        },
        required: ['index', 'priority', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'mails'],
  additionalProperties: false,
} as const;

// API 混雑（529 など）は数分続くことがあり、SDK 既定のリトライ（数秒間隔）では
// 乗り切れない。毎朝の cron を一度の混雑で落とさないよう、間隔を空けて再試行する。
const RETRY_WAITS_MS = [30_000, 60_000, 120_000];

function isRetryable(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.APIError) {
    const status = Number(e.status);
    return status === 429 || status >= 500;
  }
  return false;
}

export async function createMessageWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (e) {
      if (!isRetryable(e) || attempt >= RETRY_WAITS_MS.length) throw e;
      const waitMs = RETRY_WAITS_MS[attempt]!;
      console.warn(
        `LLM API エラーのため ${waitMs / 1000} 秒待って再試行します (${attempt + 1}/${RETRY_WAITS_MS.length}): ${(e as Error).message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** 収集結果から日本語ブリーフィングを生成する。 */
export async function generateBriefing(input: CollectedInput): Promise<GeneratedBriefing> {
  const { apiKey, model } = config.llm;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY が未設定です。.env を確認してください。');
  }

  const client = new Anthropic({ apiKey });
  const response = await createMessageWithRetry(client, {
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });

  if (response.stop_reason !== 'end_turn') {
    throw new Error(`LLM 応答が不完全です (stop_reason=${response.stop_reason})`);
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error('LLM 応答にテキストブロックがありません');
  }
  const output = parseModelOutput(text);
  const mails = applyMailTriage(input.mailCandidates, output.mails);

  return {
    title: output.title,
    summary: output.summary,
    usage: usageFromResponse(response),
    payload: {
      date: input.date,
      lang: config.briefing.lang,
      deadlines: input.deadlines,
      todayEvents: input.todayEvents,
      events: input.events,
      calendarChanges: input.calendarChanges ?? [],
      todos: input.todos,
      mails,
      github: input.github,
    },
  };
}

/** 収集結果を LLM へ渡すテキストに整形する（メール候補には index を振る）。 */
export function buildUserPrompt(input: CollectedInput): string {
  const tz = config.briefing.tz;
  const fmtInstant = (iso: string) =>
    iso.length === 10 // YYYY-MM-DD（日付のみ）はそのまま
      ? iso
      : new Date(iso).toLocaleString('ja-JP', {
          timeZone: tz,
          month: 'numeric',
          day: 'numeric',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  const lines: string[] = [`# ブリーフィング日付: ${input.date} (${tz})`, ''];

  lines.push(`## 今日の予定 (${input.todayEvents.length}件)`);
  for (const e of input.todayEvents) {
    lines.push(`- ${fmtInstant(e.startAt)} ${e.title}${e.location ? ` @${e.location}` : ''}`);
  }

  lines.push('', `## 締切 (${input.deadlines.length}件)`);
  for (const d of input.deadlines) {
    lines.push(`- ${fmtInstant(d.dueAt)} ${d.title}${d.course ? ` [${d.course}]` : ''} (${d.source})`);
  }

  const changes = input.calendarChanges ?? [];
  const kindLabel = { new: '新規', updated: '変更', removed: '削除' } as const;
  lines.push('', `## カレンダーの変更（前回のブリーフィング以降） (${changes.length}件)`);
  for (const c of changes) {
    lines.push(`- [${kindLabel[c.kind]}] ${c.title}${c.detail ? `（${c.detail}）` : ''}`);
  }

  lines.push('', `## TODO（各リポジトリの TODO.md） (${input.todos.length}件)`);
  for (const t of input.todos) {
    lines.push(`- ${t.repo}: ${t.text}`);
  }

  lines.push('', `## 昨日の GitHub 活動 (${input.github.length}件)`);
  for (const g of input.github) {
    lines.push(`- [${g.kind}] ${g.repo}: ${g.title}`);
  }

  lines.push('', `## 受信メール候補 (${input.mailCandidates.length}件)`);
  input.mailCandidates.forEach((m, i) => {
    lines.push(`[${i}] From: ${m.from}`);
    lines.push(`    Subject: ${m.subject}`);
    lines.push(`    Snippet: ${m.snippet.slice(0, 160)}`);
  });

  return lines.join('\n');
}

/** LLM のトリアージ結果を MailItem に復元する（不正 index は捨て、重複は先勝ち）。 */
export function applyMailTriage(
  candidates: CollectedInput['mailCandidates'],
  entries: MailTriageEntry[],
): MailItem[] {
  const seen = new Set<number>();
  const items: MailItem[] = [];
  for (const e of entries) {
    if (!Number.isInteger(e.index) || seen.has(e.index)) continue;
    const c = candidates[e.index];
    if (!c) continue;
    seen.add(e.index);
    items.push({
      priority: e.priority,
      from: c.from,
      subject: c.subject,
      reason: e.reason,
      gmailLink: c.gmailLink,
    });
  }
  // 要対応を先頭に。同一区分内は候補順（= 新しい順）を保つ。
  return items.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'action' ? -1 : 1));
}

/** 構造化出力の JSON をパースし、最低限の形を検証する。 */
export function parseModelOutput(text: string): ModelOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`LLM 出力が JSON としてパースできません: ${text.slice(0, 200)}`);
  }
  const o = parsed as Partial<ModelOutput>;
  if (typeof o.title !== 'string' || typeof o.summary !== 'string' || !Array.isArray(o.mails)) {
    throw new Error(`LLM 出力がスキーマに一致しません: ${text.slice(0, 200)}`);
  }
  return o as ModelOutput;
}
