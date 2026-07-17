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

-- 手動で完了にした締切（uid = ics の UID `event-assignment-<id>`。canvas 由来のみ）
CREATE TABLE IF NOT EXISTS deadline_completions (
  uid          TEXT PRIMARY KEY,
  title        TEXT NOT NULL,                  -- 完了時点の課題名（表示・デバッグ用スナップショット）
  due_at       TEXT NOT NULL,                  -- ISO8601 or YYYY-MM-DD（古い行の掃除の基準）
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- LLM API 呼び出しの usage 記録（管理画面の AI 利用状況表示用）
CREATE TABLE IF NOT EXISTS llm_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_date TEXT,                          -- 対象日（ブリーフィング生成の場合）
  purpose       TEXT NOT NULL,                 -- briefing など呼び出し種別
  model         TEXT NOT NULL,                 -- API が返した実モデル ID
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL,                          -- 単価不明のモデルは NULL
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at);

-- カレンダー/締切の変更検知用スナップショット（前回ブリーフィング時点の状態）。
-- 毎回のブリーフィングで収集窓の内容と突き合わせ、追加/変更/削除を検出してから置き換える
CREATE TABLE IF NOT EXISTS calendar_items (
  key         TEXT PRIMARY KEY,   -- 'gcal:<eventId>' / 'canvas:<uid>'
  source      TEXT NOT NULL,      -- calendar | canvas
  fingerprint TEXT NOT NULL,      -- 変更検知用: calendar=start|end|title|location / canvas・終日=dueAt|title
  start_at    TEXT NOT NULL,      -- 開始(期日)。窓スクロールアウトの誤「削除」判定を防ぐ基準
  title       TEXT NOT NULL,      -- 変更メッセージ表示用スナップショット
  last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_meta (
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 管理画面から変更できる設定（key-value）。値は JSON 文字列
-- google_calendar_ids: 収集対象カレンダー ID の JSON 配列（無ければ .env の GOOGLE_CALENDAR_IDS）
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
