// 管理画面から変更できる設定の読み書き。保存先は SQLite の settings テーブルで、
// 未設定の間は .env の値にフォールバックする（既存環境は無変更で動く）。
import { getSetting, setSetting } from './db/repo.js';
import { config } from './config.js';

const KEY_GOOGLE_CALENDAR_IDS = 'google_calendar_ids';

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
