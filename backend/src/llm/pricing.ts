// LLM API の利用料金計算。単価は 2026-06 時点の公表価格（USD / 100万トークン）。
// キャッシュ読み取りは入力単価の 0.1 倍、キャッシュ書き込み（5分 TTL）は 1.25 倍。
import type Anthropic from '@anthropic-ai/sdk';

/** 1 回の API 呼び出しの usage（DB 保存と表示に使う）。 */
export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** USD。単価表に無いモデルは null */
  costUsd: number | null;
}

// モデル ID は前方一致で解決する（エイリアス claude-haiku-4-5 と
// フル ID claude-haiku-4-5-20251001 の両方に一致させるため）。
const PRICES_PER_MTOK: { prefix: string; input: number; output: number }[] = [
  { prefix: 'claude-haiku-4-5', input: 1, output: 5 },
  { prefix: 'claude-sonnet-5', input: 3, output: 15 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15 },
  { prefix: 'claude-opus-4', input: 5, output: 25 },
];

const CACHE_READ_RATE = 0.1;
const CACHE_WRITE_RATE = 1.25;

/** API レスポンスの usage からトークン数とコストをまとめる。 */
export function usageFromResponse(response: Anthropic.Message): LlmUsage {
  const u = response.usage;
  const usage: LlmUsage = {
    model: response.model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    costUsd: null,
  };
  usage.costUsd = calcCostUsd(usage);
  return usage;
}

/** 単価表からコスト（USD）を計算する。未知モデルは null。 */
export function calcCostUsd(u: Omit<LlmUsage, 'costUsd'>): number | null {
  const price = PRICES_PER_MTOK.find((p) => u.model.startsWith(p.prefix));
  if (!price) return null;
  return (
    (u.inputTokens * price.input +
      u.outputTokens * price.output +
      u.cacheReadInputTokens * price.input * CACHE_READ_RATE +
      u.cacheCreationInputTokens * price.input * CACHE_WRITE_RATE) /
    1_000_000
  );
}
