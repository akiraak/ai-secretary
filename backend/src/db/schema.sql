-- ai-secretary backend スキーマ（idempotent）
-- 変更時は末尾の schema_meta.version を上げる

-- iOS デバイストークン登録（POST /devices）
CREATE TABLE IF NOT EXISTS devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL DEFAULT 'ios',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 生成した朝ブリーフィング（アプリのプル元 / GET /briefings/latest）
CREATE TABLE IF NOT EXISTS briefings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_date TEXT NOT NULL,                 -- America/Los_Angeles の YYYY-MM-DD
  lang          TEXT NOT NULL DEFAULT 'ja',
  title         TEXT,                          -- 通知タイトル
  summary       TEXT,                          -- 通知本文（短文）
  payload_json  TEXT NOT NULL,                 -- 構造化ブリーフィング（締切/今日やる/要対応/GitHub）
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  pushed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_briefings_date ON briefings(briefing_date);

-- 各コレクタの生データ（デバッグ・再生成用に保存）
CREATE TABLE IF NOT EXISTS collector_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_date TEXT NOT NULL,
  source        TEXT NOT NULL,                 -- calendar | gmail | canvas | github | todos
  status        TEXT NOT NULL,                 -- ok | error
  raw_json      TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collector_runs_date ON collector_runs(briefing_date, source);

-- push 送信結果ログ
CREATE TABLE IF NOT EXISTS push_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_id  INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,                  -- sent | failed
  apns_id      TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_meta (
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
