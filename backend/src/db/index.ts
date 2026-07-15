import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db: Database.Database | null = null;

/** SQLite 接続を返す（初回はファイル作成 + スキーマ適用）。プロセス内でシングルトン。 */
export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.db.path), { recursive: true });
  const conn = new Database(config.db.path);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');

  applySchema(conn);
  db = conn;
  return db;
}

/** schema.sql を適用する（CREATE IF NOT EXISTS なので何度呼んでも安全）。 */
export function applySchema(conn: Database.Database): void {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  conn.exec(sql);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
