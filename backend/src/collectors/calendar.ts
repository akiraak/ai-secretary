// Calendar コレクタ: 今日（シアトル時間）の予定と締切を取得する。
// - 時刻付きイベント → todayEvents (EventItem)
// - 終日イベント     → deadlines (DeadlineItem, source: 'calendar')
//   （Canvas 由来の締切は Step 3 の iCal コレクタで別途収集する）
import { calendarClient } from '../auth/google.js';
import { config } from '../config.js';
import { tzDayRange } from '../util/time.js';
import type { EventItem, DeadlineItem } from '../types.js';

export interface CalendarResult {
  events: EventItem[];
  deadlines: DeadlineItem[];
}

/** now(既定は現在時刻) を基準に、tz ローカルの当日分を各カレンダーから集約する。 */
export async function collectCalendar(now: Date = new Date()): Promise<CalendarResult> {
  const tz = config.briefing.tz;
  const { start, end } = tzDayRange(now, tz);
  const cal = calendarClient();

  const events: EventItem[] = [];
  const deadlines: DeadlineItem[] = [];

  for (const calendarId of config.google.calendarIds) {
    const res = await cal.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true, // 繰り返しを個別イベントに展開
      orderBy: 'startTime',
      maxResults: 50,
    });

    const calName = res.data.summary ?? calendarId;
    for (const ev of res.data.items ?? []) {
      if (ev.status === 'cancelled') continue;
      const title = ev.summary?.trim() || '(無題の予定)';

      if (ev.start?.dateTime) {
        // 時刻付き = 今日の予定
        events.push({
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
        });
      }
    }
  }

  // 開始時刻で並べ替え（複数カレンダー横断のため再ソート）
  events.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return { events, deadlines };
}
