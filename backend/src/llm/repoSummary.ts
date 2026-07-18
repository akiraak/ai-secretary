// 直近作業サマリー: リポジトリ 1 つ分の直近コミット一覧を Claude で短い日本語プロースに要約する
// （GitHub タブのリポジトリ一覧・詳細画面用）。
// 毎朝の cron でリポジトリごとに呼ばれるが、そのリポジトリに push が無くコミット一覧が
// 前回と同一ならキャッシュ（repo_summary_cache）を使い LLM を呼ばない。
// キャッシュの読み書きは runBriefing 側（このモジュールは LLM 純粋層）。
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { createMessageWithRetry } from './briefing.js';
import { usageFromResponse, type LlmUsage } from './pricing.js';
import type { RepoCommit } from '../types.js';

/** プロンプト変更時に上げる（キャッシュを自然に無効化する） */
const PROMPT_VERSION = 1;

const SYSTEM_PROMPT = `あなたは Akira Kozakai のパーソナル秘書です。
1 つのリポジトリの直近コミット一覧（新しい順、日付付き）をもとに、このリポジトリで
直近どんな作業をしていたかが一目で分かる 1〜2 文の日本語サマリーを書いてください。
- リポジトリ名は表示側で別に示すため、サマリーでは繰り返さない
- 新しいコミットほど重要。直近の作業内容を中心にまとめる
- 入力に存在しない情報は決して書かない`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '1〜2文の日本語サマリー' },
  },
  required: ['summary'],
  additionalProperties: false,
} as const;

/**
 * キャッシュキー（リポジトリ単位）。そのリポジトリの直近コミット内容（message + date、順序込み）に
 * 加えプロンプト版数とモデル ID を含め、プロンプトやモデルの変更でも再生成されるようにする。
 */
export function hashRepoCommits(
  repo: string,
  commits: RepoCommit[],
  model = config.llm.model,
): string {
  const body = commits.map((c) => `${c.date}\t${c.message}`).join('\n');
  return createHash('sha256')
    .update(`v${PROMPT_VERSION}\n${model}\n${repo}\n${body}`)
    .digest('hex');
}

/** リポジトリ 1 つ分の直近コミットから LLM サマリーを生成する（空チェック・キャッシュ判定は呼び出し側）。 */
export async function generateRepoSummary(
  repo: string,
  commits: RepoCommit[],
): Promise<{ summary: string; usage: LlmUsage }> {
  const { apiKey, model } = config.llm;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY が未設定です。.env を確認してください。');
  }

  const lines = [`# リポジトリ ${repo} の直近コミット (${commits.length}件、新しい順)`];
  for (const c of commits) lines.push(`- ${c.date.slice(0, 10)}: ${c.message}`);

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
