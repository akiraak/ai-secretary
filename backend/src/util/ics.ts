// 最小限の iCalendar (.ics) パーサ。Canvas のカレンダーフィードを読むための実装で、
// 汎用 RFC 5545 対応ではない（RRULE 等の繰り返しは扱わない。Canvas フィードは
// 展開済みの単発 VEVENT のみを含む）。外部ライブラリを避け依存を増やさない方針。
import { tzLocalToInstant } from './time.js';

/** 日付のみ（終日/締切日）か、時刻付きインスタントか。 */
export type IcsDate =
  | { dateOnly: true; date: string } // YYYY-MM-DD
  | { dateOnly: false; instant: Date };

export interface IcsEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  start?: IcsDate;
  end?: IcsDate;
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * .ics テキストから VEVENT を抽出する。
 * fallbackTz は Z も TZID も付かない「floating time」に適用するタイムゾーン。
 */
export function parseIcs(text: string, fallbackTz: string): IcsEvent[] {
  // 行折り返し（改行 + SP/TAB による継続行）を展開してから行に分割
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);

  const events: IcsEvent[] = [];
  let current: IcsEvent | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current || !line) continue;

    const prop = parseProperty(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID':
        current.uid = prop.value;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(prop.value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value);
        break;
      case 'LOCATION':
        current.location = unescapeText(prop.value);
        break;
      case 'URL':
        current.url = prop.value;
        break;
      case 'DTSTART':
        current.start = parseIcsDate(prop, fallbackTz);
        break;
      case 'DTEND':
        current.end = parseIcsDate(prop, fallbackTz);
        break;
    }
  }
  return events;
}

/** `NAME;PARAM=V;PARAM="a:b":value` を分解する。パラメータ値の引用符内の : ; は区切りにしない。 */
function parseProperty(line: string): IcsProperty | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;

  const [name = '', ...paramParts] = splitOutsideQuotes(line.slice(0, colon), ';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const parts: string[] = [];
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === sep && !inQuote) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/**
 * DTSTART/DTEND の値を解釈する。対応形式:
 * - `20260716`（VALUE=DATE）→ 日付のみ
 * - `20260716T065959Z` → UTC
 * - `20260716T235900`（TZID=... または floating）→ 当該 tz の壁時計時刻
 */
function parseIcsDate(prop: IcsProperty, fallbackTz: string): IcsDate | undefined {
  const v = prop.value.trim();

  const dateM = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateM) return { dateOnly: true, date: `${dateM[1]}-${dateM[2]}-${dateM[3]}` };

  const dtM = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dtM) return undefined;
  const [y, mo, d, hh, mm, ss] = dtM.slice(1, 7).map((n) => Number.parseInt(n!, 10)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (dtM[7] === 'Z') {
    return { dateOnly: false, instant: new Date(Date.UTC(y, mo - 1, d, hh, mm, ss)) };
  }
  const tz = prop.params['TZID'] ?? fallbackTz;
  return { dateOnly: false, instant: tzLocalToInstant(y, mo, d, hh, tz, mm, ss) };
}

/** TEXT 値のエスケープ（\n \; \, \\）を復元する。 */
function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}
