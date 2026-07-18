// 管理画面から変更できる設定の読み書き。保存先は SQLite の settings テーブルで、
// 未設定の間は .env の値にフォールバックする（既存環境は無変更で動く）。
import { getSetting, setSetting } from './db/repo.js';
import { config } from './config.js';

const KEY_GOOGLE_CALENDAR_IDS = 'google_calendar_ids';
const KEY_CANVAS_LOOKAHEAD_DAYS = 'canvas_lookahead_days';

/** Canvas 先読み日数として許可する範囲（管理画面からの誤入力ガード）。 */
export const CANVAS_LOOKAHEAD_MIN = 1;
export const CANVAS_LOOKAHEAD_MAX = 60;

function isValidLookaheadDays(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= CANVAS_LOOKAHEAD_MIN &&
    v <= CANVAS_LOOKAHEAD_MAX
  );
}

/** Canvas 締切の先読み日数。DB 設定を優先し、無ければ .env の CANVAS_LOOKAHEAD_DAYS。 */
export function resolveCanvasLookaheadDays(): number {
  return getCanvasLookaheadDays().value;
}

/** 先読み日数と出どころ（管理画面の表示用）。壊れた値は .env フォールバック。 */
export function getCanvasLookaheadDays(): { value: number; source: 'db' | 'env' } {
  const raw = getSetting(KEY_CANVAS_LOOKAHEAD_DAYS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isValidLookaheadDays(parsed)) return { value: parsed, source: 'db' };
    } catch {
      // 壊れた値は無視して .env フォールバック
    }
  }
  return { value: config.canvas.lookaheadDays, source: 'env' };
}

/** Canvas 締切の先読み日数を保存する。範囲外は拒否する。 */
export function saveCanvasLookaheadDays(days: number): void {
  if (!isValidLookaheadDays(days)) {
    throw new Error(
      `先読み日数は ${CANVAS_LOOKAHEAD_MIN}〜${CANVAS_LOOKAHEAD_MAX} の整数で指定してください`,
    );
  }
  setSetting(KEY_CANVAS_LOOKAHEAD_DAYS, JSON.stringify(days));
}

/** 収集対象カレンダー ID。DB 設定を優先し、無ければ .env の GOOGLE_CALENDAR_IDS。 */
export function resolveCalendarIds(): string[] {
  const raw = getSetting(KEY_GOOGLE_CALENDAR_IDS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const ids = parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
        if (ids.length > 0) return ids;
      }
    } catch {
      // 壊れた値は無視して .env フォールバック
    }
  }
  return config.google.calendarIds;
}

/** 収集対象カレンダー ID を保存する（空配列は呼び出し側で弾くこと）。 */
export function saveCalendarIds(ids: string[]): void {
  setSetting(KEY_GOOGLE_CALENDAR_IDS, JSON.stringify(ids));
}
