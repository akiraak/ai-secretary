// `npm run db:init` — SQLite ファイルを作成しスキーマを適用する。
import { getDb, closeDb } from './index.js';
import { config } from '../config.js';

const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as { name: string }[];

console.log(`DB 初期化完了: ${config.db.path}`);
console.log(`テーブル: ${tables.map((t) => t.name).join(', ')}`);
closeDb();
