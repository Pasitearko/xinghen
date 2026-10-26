// SQLite 由 Node 内置的 node:sqlite 提供：无需编译原生扩展，开 WAL 后读写互不阻塞。
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { DB_PATH } from './paths.ts'

const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS diary_entries (
  id INTEGER PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  date_key TEXT NOT NULL,
  entry_index INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  weather TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  char_count INTEGER NOT NULL DEFAULT 0,
  excerpt TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (date_key, entry_index)
);
CREATE INDEX IF NOT EXISTS ix_diary_date ON diary_entries(date_key);

CREATE TABLE IF NOT EXISTS image_assets (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  scope TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taste_items (
  id INTEGER PRIMARY KEY,
  legacy_id TEXT UNIQUE,
  type TEXT NOT NULL DEFAULT 'link',
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_todos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 25,
  break_minutes INTEGER NOT NULL DEFAULT 5,
  completed_pomodoros INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_schedule (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  date_key TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  is_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_schedule_date ON study_schedule(date_key);

CREATE TABLE IF NOT EXISTS study_sessions (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  todo_id INTEGER REFERENCES study_todos(id) ON DELETE SET NULL,
  date_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  planned_minutes INTEGER NOT NULL DEFAULT 25,
  focused_seconds INTEGER NOT NULL DEFAULT 0,
  pomodoros INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_date ON study_sessions(date_key);

CREATE TABLE IF NOT EXISTS news_sources (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'never',
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  last_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY,
  dedup_key TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL,
  source_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  published_day TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_news_day ON news_items(published_day);
CREATE INDEX IF NOT EXISTS ix_news_source ON news_items(source_key);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  motto TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export const db = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: true })
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;')
db.exec(SCHEMA)
db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)

type Params = SQLInputValue[]
type Row = Record<string, unknown>

const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>()
function stmt(sql: string) {
  let s = cache.get(sql)
  if (!s) {
    s = db.prepare(sql)
    cache.set(sql, s)
  }
  return s
}

export function all<T = Row>(sql: string, ...params: Params): T[] {
  return stmt(sql).all(...params) as T[]
}
export function get<T = Row>(sql: string, ...params: Params): T | undefined {
  return stmt(sql).get(...params) as T | undefined
}
export function run(sql: string, ...params: Params) {
  return stmt(sql).run(...params)
}

let depth = 0
/** 嵌套调用时只有最外层真正开启事务。 */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn()
  depth++
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  } finally {
    depth--
  }
}

export function kvGet<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}
export function kvSet(key: string, value: unknown) {
  run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
}

export function parseJsonArray<T = string>(value: unknown): T[] {
  if (typeof value !== 'string') return []
  try {
    const out = JSON.parse(value)
    return Array.isArray(out) ? out : []
  } catch {
    return []
  }
}
