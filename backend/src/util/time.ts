// タイムゾーン依存の日付計算。ブリーフィングの「今日」はシアトル時間
// (America/Los_Angeles) で決めるため、tz ローカルの日境界を UTC 時刻へ変換する。
// 外部ライブラリを使わず Intl.DateTimeFormat のオフセット法で算出する
// （深夜は DST 遷移に当たらないため、この方式で十分正確）。

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

/** 指定インスタントを tz ローカルに直したときの年月日を返す。 */
export function tzYmd(instant: Date, tz: string): Ymd {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number.parseInt(parts.find((p) => p.type === t)!.value, 10);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** tz ローカルの YYYY-MM-DD 文字列（ブリーフィング日付）。 */
export function briefingDate(instant: Date, tz: string): string {
  const { year, month, day } = tzYmd(instant, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 指定インスタントを tz ローカルの壁時計時刻とみなした UTC ミリ秒（オフセット計算用）。 */
function wallClockUtcMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => Number.parseInt(parts.find((p) => p.type === t)!.value, 10);
  // Intl は 24:00 を返すことがあるため 0 に丸める
  const hour = get('hour') % 24;
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

/** tz ローカルの (y,m,d,h,mm,ss) に対応する実インスタントを返す。 */
export function tzLocalToInstant(
  y: number,
  m: number,
  d: number,
  hour: number,
  tz: string,
  minute = 0,
  second = 0,
): Date {
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, second);
  const offset = wallClockUtcMs(new Date(utcGuess), tz) - utcGuess; // = local - utc
  return new Date(utcGuess - offset);
}

/**
 * tz ローカルの「その日」の範囲 [start, end) を UTC インスタントで返す。
 * start = 当日 00:00、end = 翌日 00:00。
 */
export function tzDayRange(instant: Date, tz: string): { start: Date; end: Date } {
  const { year, month, day } = tzYmd(instant, tz);
  const start = tzLocalToInstant(year, month, day, 0, tz);
  const end = tzLocalToInstant(year, month, day + 1, 0, tz); // day+1 は Date.UTC が正規化
  return { start, end };
}
