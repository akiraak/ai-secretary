// ブリーフィングの構造化データ型。
// iOS 画面（締切 → 今日やる → 要対応 → 昨日の GitHub）と 1:1 で対応させる。
// 参照: docs/specs/ios-app-screens.md

export type Priority = 'action' | 'info';

/** Canvas / Calendar から抽出した締切 */
export interface DeadlineItem {
  source: 'canvas' | 'calendar';
  title: string;
  dueAt: string; // ISO8601
  course?: string;
}

/** リポジトリ TODO.md から抽出した「今日やる／次の作業」 */
export interface TodoItem {
  repo: string;
  text: string;
}

/** Gmail トリアージ結果（要対応 / 参考） */
export interface MailItem {
  priority: Priority;
  from: string;
  subject: string;
  reason: string; // トリアージ理由（spec 1-2 のルール）
  gmailLink?: string;
}

/**
 * Gmail から取得した生の要対応候補（トリアージ前）。
 * Step 4 の LLM 層がこの配列からトリアージ規則を適用して MailItem を生成する。
 */
export interface RawMailCandidate {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string; // ISO8601（取得できない場合は空文字）
  labelIds: string[];
  gmailLink: string;
}

/** 昨日の GitHub 活動 */
export interface GithubItem {
  repo: string;
  kind: 'commit' | 'pr';
  title: string;
  url?: string;
}

/** 今日の予定 */
export interface EventItem {
  title: string;
  startAt: string; // ISO8601
  endAt?: string;
  location?: string;
}

/**
 * 全コレクタの収集結果（LLM 層への入力）。
 * deadlines は Canvas + Calendar 終日イベント由来をマージ済み。
 */
export interface CollectedInput {
  date: string; // America/Los_Angeles の YYYY-MM-DD
  todayEvents: EventItem[];
  deadlines: DeadlineItem[];
  todos: TodoItem[];
  github: GithubItem[];
  mailCandidates: RawMailCandidate[];
}

/** briefings.payload_json に格納する構造化ブリーフィング全体 */
export interface BriefingPayload {
  date: string; // America/Los_Angeles の YYYY-MM-DD
  lang: string;
  deadlines: DeadlineItem[];
  todayEvents: EventItem[];
  todos: TodoItem[];
  mails: MailItem[];
  github: GithubItem[];
}

/** briefings テーブル 1 行 */
export interface BriefingRow {
  id: number;
  briefing_date: string;
  lang: string;
  title: string | null;
  summary: string | null;
  payload_json: string;
  created_at: string;
  pushed_at: string | null;
}

/** devices テーブル 1 行 */
export interface DeviceRow {
  id: number;
  token: string;
  platform: string;
  created_at: string;
  updated_at: string;
}
