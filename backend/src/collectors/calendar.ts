// Calendar コレクタ: 今日から CALENDAR_LOOKAHEAD_DAYS 日分（シアトル時間）の予定と締切を取得する。
// - 時刻付きイベント → events (EventItem)。当日分のサブセットが todayEvents（HOME・LLM プロンプト用）
// - 終日イベント     → deadlines (DeadlineItem, source: 'calendar')
//   （Canvas 由来の締切は Step 3 の iCal コレクタで別途収集する）
// イベント ID は変更検知（calendar_items との差分）のキーとして保持する。
import { calendarClient } from '../auth/google.js';
import { config } from '../config.js';
import { resolveCalendarIds } from '../settings.js';
import { briefingDate, tzDayRange, tzLocalToInstant, tzYmd } from '../util/time.js';
import type { EventItem, DeadlineItem } from '../types.js';

export interface CalendarResult {
  /** 収集窓内の全予定（時刻付き） */
  events: EventItem[];
  /** events のうち今日（tz）開始のもの */
  todayEvents: EventItem[];
  deadlines: DeadlineItem[];
}

/** now(既定は現在時刻) を基準に、tz ローカルの今日から lookahead 日分を各カレンダーから集約する。 */
export async function collectCalendar(now: Date = new Date()): Promise<CalendarResult> {
  const tz = config.briefing.tz;
  const { start } = tzDayRange(now, tz);
  const { year, month, day } = tzYmd(now, tz);
  const end = tzLocalToInstant(year, month, day + config.google.calendarLookaheadDays, 0, tz);
  const today = briefingDate(now, tz);
  const cal = calendarClient();

  const events: EventItem[] = [];
  const deadlines: DeadlineItem[] = [];

  for (const calendarId of resolveCalendarIds()) {
    let pageToken: string | undefined;
    let calName: string | undefined;
    do {
      const res = await cal.events.list({
        calendarId,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true, // 繰り返しを個別イベントに展開
        orderBy: 'startTime',
        maxResults: 250,
        pageToken,
      });
      calName ??= res.data.summary ?? calendarId;

      for (const ev of res.data.items ?? []) {
        if (ev.status === 'cancelled') continue;
        const title = ev.summary?.trim() || '(無題の予定)';

        if (ev.start?.dateTime) {
          // 時刻付き = 予定
          events.push({
            id: ev.id ?? undefined,
            title,
            startAt: ev.start.dateTime,
            endAt: ev.end?.dateTime ?? undefined,
            location: ev.location ?? undefined,
          });
        } else if (ev.start?.date) {
          // 終日 = 締切扱い
          deadlines.push({
            source: 'calendar',
            title,
            dueAt: ev.start.date, // YYYY-MM-DD
            course: calName,
            id: ev.id ?? undefined,
          });
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  // 開始時刻で並べ替え（複数カレンダー横断のため再ソート）
  events.sort((a, b) => a.startAt.localeCompare(b.startAt));
  deadlines.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const todayEvents = events.filter((e) => briefingDate(new Date(e.startAt), tz) === today);
  return { events, todayEvents, deadlines };
}
