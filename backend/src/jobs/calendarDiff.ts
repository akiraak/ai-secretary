// カレンダー変更検知: 前回ブリーフィング時点のスナップショット (calendar_items) と
// 今回の収集内容を突き合わせ、追加/変更/削除を CalendarChange として返す。
// 方式はスナップショット差分（Google の syncToken は使わない）。
// 参照: docs/plans/calendar-change-detection.md
import { config } from '../config.js';
import { briefingDate, tzLocalToInstant, tzYmd } from '../util/time.js';
import { listCalendarItems, replaceCalendarItems, type CalendarItemRow } from '../db/repo.js';
import type { CalendarChange, CollectedInput, DeadlineItem, EventItem } from '../types.js';

export type SnapshotItem = Omit<CalendarItemRow, 'source'>;

export interface CalendarDiffResult {
  changes: CalendarChange[];
  /** 今回の収集に存在する項目の変更種別（key → new/updated）。changed フラグ付与用 */
  changedKeys: Map<string, 'new' | 'updated'>;
}

/** 変更メッセージ用の日時表記（終日は「7/21(火)」、時刻付きは「7/21(火) 10:00」）。 */
export function fmtChangeInstant(s: string, tz: string): string {
  if (s.length === 10 && !s.includes('T')) {
    // YYYY-MM-DD は tz 変換せずそのまま（UTC 正午扱いで曜日の日ズレを防ぐ）
    return new Date(`${s}T12:00:00Z`).toLocaleDateString('ja-JP', {
      timeZone: 'UTC',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
    });
  }
  return new Date(s).toLocaleString('ja-JP', {
    timeZone: tz,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 時刻付き予定 + calendar 終日イベントを 'gcal:<id>' キーのスナップショットにする。 */
export function buildCalendarSnapshot(
  events: EventItem[],
  deadlines: DeadlineItem[],
): SnapshotItem[] {
  // 同一イベントが複数カレンダーに現れることがあるため key で重複排除（先勝ち）
  const byKey = new Map<string, SnapshotItem>();
  for (const e of events) {
    if (!e.id) continue;
    const key = `gcal:${e.id}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      fingerprint: [e.startAt, e.endAt ?? '', e.title, e.location ?? ''].join('|'),
      start_at: e.startAt,
      title: e.title,
    });
  }
  for (const d of deadlines) {
    if (d.source !== 'calendar' || !d.id) continue;
    const key = `gcal:${d.id}`;
    if (byKey.has(key)) continue;
    byKey.set(key, { key, fingerprint: `${d.dueAt}|${d.title}`, start_at: d.dueAt, title: d.title });
  }
  return [...byKey.values()];
}

/** canvas 締切を 'canvas:<uid>' キーのスナップショットにする。 */
export function buildCanvasSnapshot(deadlines: DeadlineItem[]): SnapshotItem[] {
  const byKey = new Map<string, SnapshotItem>();
  for (const d of deadlines) {
    if (d.source !== 'canvas' || !d.uid) continue;
    const key = `canvas:${d.uid}`;
    if (byKey.has(key)) continue;
    byKey.set(key, { key, fingerprint: `${d.dueAt}|${d.title}`, start_at: d.dueAt, title: d.title });
  }
  return [...byKey.values()];
}

export interface SourceDiffInput {
  prev: SnapshotItem[];
  current: SnapshotItem[];
  source: 'calendar' | 'canvas';
  /** 今日 (tz) の YYYY-MM-DD。これより前に始まる項目の消失は「削除」にしない */
  today: string;
  /** 収集窓の最終日 (YYYY-MM-DD)。これ以降に始まる新出項目は「窓に入っただけ」なので new にしない */
  newCutoff: string;
  tz: string;
}

/** 1 ソース分のスナップショット差分（純粋関数。DB は触らない）。 */
export function diffCalendarItems(input: SourceDiffInput): CalendarDiffResult {
  const { prev, current, source, today, newCutoff, tz } = input;
  const prevMap = new Map(prev.map((p) => [p.key, p]));
  const currentKeys = new Set(current.map((c) => c.key));
  const changes: CalendarChange[] = [];
  const changedKeys = new Map<string, 'new' | 'updated'>();

  for (const cur of current) {
    const p = prevMap.get(cur.key);
    if (!p) {
      if (cur.start_at >= newCutoff) continue; // 窓のスクロールで末端に入っただけ
      changedKeys.set(cur.key, 'new');
      changes.push({ kind: 'new', source, title: cur.title, detail: fmtChangeInstant(cur.start_at, tz) });
    } else if (p.fingerprint !== cur.fingerprint) {
      changedKeys.set(cur.key, 'updated');
      changes.push({ kind: 'updated', source, title: cur.title, detail: updateDetail(p, cur, tz) });
    }
  }

  // 削除: 前回に在って今回に無いもの。過去へスクロールアウトしただけの項目を除くため
  // 未来開始のものだけ。Canvas はフィードが消えることを主張しないので削除を出さない
  if (source === 'calendar') {
    for (const p of prev) {
      if (currentKeys.has(p.key) || p.start_at < today) continue;
      changes.push({ kind: 'removed', source, title: p.title, detail: fmtChangeInstant(p.start_at, tz) });
    }
  }

  return { changes, changedKeys };
}

/** 変更 (updated) の内容説明。時刻の移動 → タイトル変更 → その他 の順で言語化する。 */
function updateDetail(prev: SnapshotItem, cur: SnapshotItem, tz: string): string {
  if (prev.start_at !== cur.start_at) {
    return `${fmtChangeInstant(prev.start_at, tz)} → ${fmtChangeInstant(cur.start_at, tz)}`;
  }
  if (prev.title !== cur.title) {
    return `「${prev.title}」→「${cur.title}」`;
  }
  return '場所・終了時刻などの変更';
}

/**
 * 収集結果と calendar_items を突き合わせて変更を検出し、スナップショットを今回の状態へ更新する。
 * - sources で false のソース（コレクタ失敗）は差分もスナップショット更新もしない（誤削除防止）
 * - ソースの前回スナップショットが空なら初回とみなしベースライン投入のみ（変更は出さない）
 */
export function detectCalendarChanges(args: {
  events: EventItem[];
  deadlines: DeadlineItem[];
  sources: { calendar: boolean; canvas: boolean };
  now: Date;
}): CalendarDiffResult {
  const tz = config.briefing.tz;
  const today = briefingDate(args.now, tz);
  const { year, month, day } = tzYmd(args.now, tz);
  // 窓は [今日, 今日+N日) なので最終日は today+N-1
  const cutoff = (lookaheadDays: number) =>
    briefingDate(tzLocalToInstant(year, month, day + lookaheadDays - 1, 0, tz), tz);

  const changes: CalendarChange[] = [];
  const changedKeys = new Map<string, 'new' | 'updated'>();
  const run = (source: 'calendar' | 'canvas', current: SnapshotItem[], newCutoff: string) => {
    const prev = listCalendarItems(source);
    if (prev.length > 0) {
      const diff = diffCalendarItems({ prev, current, source, today, newCutoff, tz });
      changes.push(...diff.changes);
      for (const [k, v] of diff.changedKeys) changedKeys.set(k, v);
    }
    replaceCalendarItems(source, current);
  };

  if (args.sources.calendar) {
    run('calendar', buildCalendarSnapshot(args.events, args.deadlines), cutoff(config.google.calendarLookaheadDays));
  }
  if (args.sources.canvas) {
    run('canvas', buildCanvasSnapshot(args.deadlines), cutoff(config.canvas.lookaheadDays));
  }

  const order = { new: 0, updated: 1, removed: 2 } as const;
  changes.sort((a, b) => order[a.kind] - order[b.kind]);
  return { changes, changedKeys };
}

/** 検出した変更種別を収集結果の events / deadlines に changed フラグとして付与する。 */
export function annotateChanges(
  input: Pick<CollectedInput, 'events' | 'todayEvents' | 'deadlines'>,
  changedKeys: Map<string, 'new' | 'updated'>,
): void {
  const mark = (item: EventItem | DeadlineItem, key: string | undefined) => {
    if (!key) return;
    const changed = changedKeys.get(key);
    if (changed) item.changed = changed;
  };
  // todayEvents は events のサブセット（同一オブジェクト参照）だが、別配列でも漏れないよう両方なめる
  for (const e of [...input.events, ...input.todayEvents]) mark(e, e.id && `gcal:${e.id}`);
  for (const d of input.deadlines) {
    mark(d, d.source === 'canvas' ? d.uid && `canvas:${d.uid}` : d.id && `gcal:${d.id}`);
  }
}
