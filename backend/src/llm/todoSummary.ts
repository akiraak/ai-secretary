// TODO サマリー: 各リポジトリの TODO.md タスク一覧を Claude で短い日本語プロースに要約する。
// 毎朝の cron で呼ばれるが、TODO が前回と同一ならキャッシュ（todo_summary_cache）を使い
// LLM を呼ばない。キャッシュの読み書きは runBriefing 側（このモジュールは LLM 純粋層）。
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { createMessageWithRetry } from './briefing.js';
import { usageFromResponse, type LlmUsage } from './pricing.js';
import type { TodoItem } from '../types.js';

/** プロンプト変更時に上げる（キャッシュを自然に無効化する） */
const PROMPT_VERSION = 1;

const SYSTEM_PROMPT = `あなたは Akira Kozakai のパーソナル秘書です。
各リポジトリの TODO.md から集めた未完了タスク一覧をもとに、いま何に取り組んでいて次に何をやるのかが
一目で分かる 2〜3 文の日本語サマリーを書いてください。
- リポジトリ名と件数に触れる（例: 「ai-secretary は通知まわりの改善が中心（8件）」）
- タスクの多いリポジトリや先頭のタスクを優先して言及する
- 入力に存在しない情報は決して書かない`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2〜3文の日本語サマリー' },
  },
  required: ['summary'],
  additionalProperties: false,
} as const;

/**
 * キャッシュキー。TODO の内容（repo + text、順序込み）に加えプロンプト版数とモデル ID を
 * 含め、プロンプトやモデルの変更でも再生成されるようにする。
 */
export function hashTodos(todos: TodoItem[], model = config.llm.model): string {
  const body = todos.map((t) => `${t.repo}\t${t.text}`).join('\n');
  return createHash('sha256').update(`v${PROMPT_VERSION}\n${model}\n${body}`).digest('hex');
}

/** TODO 一覧から LLM サマリーを生成する（空チェック・キャッシュ判定は呼び出し側）。 */
export async function generateTodoSummary(
  todos: TodoItem[],
): Promise<{ summary: string; usage: LlmUsage }> {
  const { apiKey, model } = config.llm;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY が未設定です。.env を確認してください。');
  }

  const lines = [`# TODO 一覧 (${todos.length}件)`];
  for (const t of todos) lines.push(`- ${t.repo}: ${t.text}`);

  const client = new Anthropic({ apiKey });
  const response = await createMessageWithRetry(client, {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: lines.join('\n') }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });

  if (response.stop_reason !== 'end_turn') {
    throw new Error(`LLM 応答が不完全です (stop_reason=${response.stop_reason})`);
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error('LLM 応答にテキストブロックがありません');
  }
  let summary: string;
  try {
    summary = (JSON.parse(text) as { summary: string }).summary;
  } catch {
    throw new Error(`LLM 出力が JSON としてパースできません: ${text.slice(0, 200)}`);
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error(`LLM 出力がスキーマに一致しません: ${text.slice(0, 200)}`);
  }
  return { summary: summary.trim(), usage: usageFromResponse(response) };
}
