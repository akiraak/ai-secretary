import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/ ルート（src/ の 1 つ上）
export const BACKEND_ROOT = path.resolve(__dirname, '..');

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function withDefault(name: string, fallback: string): string {
  return optional(name) ?? fallback;
}

/**
 * 環境変数の集約。値の存在検証は各コレクタ/送信側が使用時に行う
 * （Step 1 の雛形では未設定でも起動できるようにするため必須チェックはしない）。
 */
export const config = {
  llm: {
    apiKey: optional('ANTHROPIC_API_KEY'),
    model: withDefault('LLM_MODEL', 'claude-haiku-4-5'),
  },
  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    refreshToken: optional('GOOGLE_REFRESH_TOKEN'),
    // 今日の予定を集めるカレンダー ID（カンマ区切り。既定は primary のみ）
    calendarIds: (optional('GOOGLE_CALENDAR_IDS') ?? 'primary')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // 予定を先読みする日数（今日から N 日後 00:00 まで。週/月表示・変更検知の収集窓）
    calendarLookaheadDays: Number.parseInt(withDefault('CALENDAR_LOOKAHEAD_DAYS', '31'), 10),
    // google:auth スクリプトのローカルループバックポート
    oauthPort: Number.parseInt(withDefault('GOOGLE_OAUTH_PORT', '5858'), 10),
  },
  gmail: {
    // 受信トレイをさかのぼる日数（要対応候補の収集範囲）
    lookbackDays: Number.parseInt(withDefault('GMAIL_LOOKBACK_DAYS', '2'), 10),
    maxResults: Number.parseInt(withDefault('GMAIL_MAX_RESULTS', '30'), 10),
  },
  canvas: {
    icalUrl: optional('CANVAS_ICAL_URL'),
    // 締切を先読みする日数（今日から N 日後 00:00 まで）
    lookaheadDays: Number.parseInt(withDefault('CANVAS_LOOKAHEAD_DAYS', '7'), 10),
  },
  github: {
    token: optional('GITHUB_TOKEN'),
    repos: (optional('GITHUB_REPOS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  apns: {
    keyId: optional('APNS_KEY_ID'),
    teamId: optional('APNS_TEAM_ID'),
    bundleId: optional('APNS_BUNDLE_ID'),
    p8Path: optional('APNS_P8_PATH'),
    env: withDefault('APNS_ENV', 'sandbox') as 'sandbox' | 'production',
  },
  briefing: {
    hour: Number.parseInt(withDefault('BRIEFING_HOUR', '7'), 10),
    tz: withDefault('TZ', 'America/Los_Angeles'),
    lang: withDefault('BRIEFING_LANG', 'ja'),
  },
  server: {
    port: Number.parseInt(withDefault('PORT', '8787'), 10),
    sharedSecret: optional('API_SHARED_SECRET'),
    // /admin* は明示的に on にしたときだけ存在する（fail-safe）。
    // 本番では前段（Cloudflare Access）の認証を設定してから有効化する。
    adminEnabled: optional('ADMIN_ENABLED') === 'on',
  },
  db: {
    path: optional('DB_PATH') ?? path.join(BACKEND_ROOT, 'data', 'ai-secretary.db'),
  },
} as const;

export type Config = typeof config;
