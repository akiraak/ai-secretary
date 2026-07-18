// ブリーフィングの構造化データ型。
// iOS 画面（締切 → GitHub(TODO サマリー) → 要対応 → 昨日の GitHub）と 1:1 で対応させる。
// 参照: docs/specs/ios-app-screens.md

export type Priority = 'action' | 'info';

/** Canvas / Calendar から抽出した締切 */
export interface DeadlineItem {
  source: 'canvas' | 'calendar';
  title: string;
  dueAt: string; // ISO8601
  course?: string;
  /** ics の UID（event-assignment-<id>）。canvas 由来のみ。手動完了チェックのキー */
  uid?: string;
  /** Google Calendar のイベント ID。calendar 由来のみ。変更検知のキー */
  id?: string;
  /** 手動で完了済みにした締切（deadline_completions 由来） */
  completed?: boolean;
  /** 前回ブリーフィング以降に追加/変更された締切（変更検知由来） */
  changed?: 'new' | 'updated';
}

/** 各リポジトリの TODO.md から抽出した未完了タスク */
export interface TodoItem {
  repo: string;
  text: string;
}

/** リポジトリ 1 つ分の TODO.md の LLM サマリー（HOME「GitHub」セクション用） */
export interface TodoRepoSummary {
  repo: string;
  summary: string;
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

/** リポジトリ詳細画面用の直近コミット 1 件 */
export interface RepoCommit {
  message: string; // 1 行目のみ
  date: string; // ISO8601
  url?: string;
}

/**
 * リポジトリ 1 つ分の概要（GitHub タブの一覧 + 詳細画面のデータ源）。
 * コレクタは repo / url / pushedAt / commits を埋め、
 * recentSummary と todo 系フィールドは runBriefing が LLM 生成・join 後に埋める。
 */
export interface RepoOverview {
  repo: string; // owner/name
  url: string; // https://github.com/owner/name
  pushedAt: string; // ISO8601。更新順ソートキー
  commits: RepoCommit[]; // 直近コミット（最大 10 件）
  recentSummary?: string; // 直近作業の LLM サマリー（生成失敗時は無し）
  todoRepo?: string; // payload.todos / todoSummaries 側のラベル（iOS の join 用）
  todoSummary?: string; // todoSummaries から join
  todoCount: number; // TODO.md の未完了件数（0 = TODO.md 無し）
}

/** kitchen-living の共有買い物リストの未購入品 1 件 */
export interface ShoppingItem {
  name: string;
  /** 追加元: "recipe"（レシピ由来） | "manual"（手動追加） */
  origin?: string;
  createdAt?: string; // ISO8601
}

/** カレンダーの予定（時刻付きイベント） */
export interface EventItem {
  /** Google Calendar のイベント ID。変更検知のキー */
  id?: string;
  title: string;
  startAt: string; // ISO8601
  endAt?: string;
  location?: string;
  /** 前回ブリーフィング以降に追加/変更された予定（変更検知由来） */
  changed?: 'new' | 'updated';
}

/** 前回ブリーフィング以降のカレンダー変更 1 件（アプリの変更一覧・LLM プロンプト用） */
export interface CalendarChange {
  kind: 'new' | 'updated' | 'removed';
  source: 'calendar' | 'canvas';
  title: string;
  /** 変更内容の短い説明（例: 「7/20(月) 10:00 → 7/21(火) 11:00」） */
  detail?: string;
}

/**
 * 全コレクタの収集結果（LLM 層への入力）。
 * deadlines は Canvas + Calendar 終日イベント由来をマージ済み。
 * events は収集窓（CALENDAR_LOOKAHEAD_DAYS）内の全予定、todayEvents はその当日分サブセット。
 */
export interface CollectedInput {
  date: string; // America/Los_Angeles の YYYY-MM-DD
  events: EventItem[];
  todayEvents: EventItem[];
  deadlines: DeadlineItem[];
  todos: TodoItem[];
  github: GithubItem[];
  mailCandidates: RawMailCandidate[];
  /** 前回ブリーフィング以降の変更（runBriefing が diff 計算後に設定する） */
  calendarChanges?: CalendarChange[];
  /** 更新順リポジトリ一覧（GitHub タブ用）。コレクタ失敗時は undefined */
  repoOverviews?: RepoOverview[];
  /** 買い物リストの未購入品。コレクタ失敗・未設定時は undefined */
  shopping?: ShoppingItem[];
}

/** briefings.payload_json に格納する構造化ブリーフィング全体 */
export interface BriefingPayload {
  date: string; // America/Los_Angeles の YYYY-MM-DD
  lang: string;
  deadlines: DeadlineItem[];
  todayEvents: EventItem[];
  /** 収集窓内の全予定（iOS の週/月表示用）。旧 payload には無い */
  events?: EventItem[];
  /** 前回ブリーフィング以降のカレンダー変更。旧 payload には無い */
  calendarChanges?: CalendarChange[];
  todos: TodoItem[];
  /** リポジトリごとの TODO.md の LLM サマリー。旧 payload には無く、生成失敗したリポジトリは含まれない */
  todoSummaries?: TodoRepoSummary[];
  /** 更新順リポジトリ一覧（GitHub タブ用）。旧 payload には無い */
  repos?: RepoOverview[];
  /** 買い物リストの未購入品。旧 payload・コレクタ失敗時には無い */
  shopping?: ShoppingItem[];
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
