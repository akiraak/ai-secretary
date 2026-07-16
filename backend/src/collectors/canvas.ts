// Canvas コレクタ: iCal フィードから今後の締切を抽出する。
// Canvas のカレンダーフィードは課題の締切を VEVENT（DTSTART = 締切日時）として配信する。
// SUMMARY は「課題名 [コース名]」形式のため、コース名を分離して DeadlineItem にする。
import { config } from '../config.js';
import { parseIcs } from '../util/ics.js';
import { briefingDate, tzLocalToInstant, tzYmd } from '../util/time.js';
import type { DeadlineItem } from '../types.js';

/** now を基準に、今日(tz)から lookaheadDays 日以内の締切を取得する。 */
export async function collectCanvas(now: Date = new Date()): Promise<DeadlineItem[]> {
  const url = config.canvas.icalUrl;
  if (!url) {
    throw new Error(
      'CANVAS_ICAL_URL が未設定です。Canvas の「カレンダー → カレンダーフィード」の URL を .env に設定してください。',
    );
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Canvas iCal フィードの取得に失敗しました: HTTP ${res.status}`);
  }
  const text = await res.text();
  return extractDeadlines(text, now);
}

/** .ics テキストから抽出する部分（フェッチと分離しテスト可能にする）。 */
export function extractDeadlines(icsText: string, now: Date): DeadlineItem[] {
  const tz = config.briefing.tz;
  const events = parseIcs(icsText, tz);

  // 締切ウィンドウ: 今日(tz) 00:00 〜 lookaheadDays 日後 00:00（過ぎた締切は拾わない）
  const { year, month, day } = tzYmd(now, tz);
  const windowStart = tzLocalToInstant(year, month, day, 0, tz);
  const windowEnd = tzLocalToInstant(year, month, day + config.canvas.lookaheadDays, 0, tz);
  const startDate = briefingDate(windowStart, tz);
  const endDate = briefingDate(windowEnd, tz);

  const deadlines: DeadlineItem[] = [];
  for (const ev of events) {
    if (!ev.start) continue;
    const summary = ev.summary?.trim() || '(無題の締切)';

    if (ev.start.dateOnly) {
      const d = ev.start.date;
      if (d < startDate || d >= endDate) continue;
      deadlines.push(makeDeadline(summary, d));
    } else {
      const t = ev.start.instant;
      if (t < windowStart || t >= windowEnd) continue;
      deadlines.push(makeDeadline(summary, t.toISOString()));
    }
  }

  deadlines.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return deadlines;
}

/** SUMMARY「課題名 [コース名]」を title / course に分ける。 */
function makeDeadline(summary: string, dueAt: string): DeadlineItem {
  const m = /^(.*?)\s*\[([^\][]+)\]$/.exec(summary);
  const title = m ? m[1]!.trim() : summary;
  return {
    source: 'canvas',
    title: title || summary,
    dueAt,
    course: m ? m[2]!.trim() : undefined,
  };
}
