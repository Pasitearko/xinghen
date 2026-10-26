// 自习室：待办、日程、专注会话。
// 计时状态只存开始时间戳，剩余时间由前端按时间戳计算，后台标签页节流也不会漂移；
// 结束记录按 session_id 幂等，两个标签页同时结束只记一次。
import { all, get, run, tx } from '../db.ts'
import { fail, int, route, str } from '../http.ts'
import { addDays, dayKey, isDateKey, nowIso, todayKey } from '../time.ts'

const bool = (v: unknown) => (v ? 1 : 0)
const toBool = <T extends Record<string, unknown>>(r: T) => ({ ...r, is_completed: !!r.is_completed })
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function todos() {
  return all('SELECT * FROM study_todos ORDER BY is_completed, sort_order, id').map(toBool)
}

function todayStats(key = todayKey()) {
  return get<{ seconds: number; pomodoros: number; sessions: number }>(
    `SELECT COALESCE(SUM(focused_seconds), 0) seconds, COALESCE(SUM(pomodoros), 0) pomodoros, COUNT(*) sessions
     FROM study_sessions WHERE date_key = ? AND status = 'finished'`,
    key,
  )!
}

route.get('/api/study/today', () => {
  const key = todayKey()
  return {
    date: key,
    todos: todos(),
    schedule: all('SELECT * FROM study_schedule WHERE date_key = ? ORDER BY start_time, id', key).map(toBool),
    active: get("SELECT * FROM study_sessions WHERE status = 'running' ORDER BY id DESC LIMIT 1") || null,
    stats: todayStats(key),
    sessions: all(
      "SELECT s.*, t.title AS todo_title FROM study_sessions s LEFT JOIN study_todos t ON t.id = s.todo_id WHERE s.date_key = ? AND s.status = 'finished' ORDER BY s.id DESC",
      key,
    ),
  }
})

route.post('/api/study/todos', async (ctx) => {
  const b = await ctx.json()
  const title = str(b.title, 200).trim()
  if (!title) fail(400, '待办需要一个名字')
  const now = nowIso()
  const order = get<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 n FROM study_todos')!.n
  run(
    'INSERT INTO study_todos(title, duration_minutes, break_minutes, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    title,
    int(b.duration_minutes, 25, 1, 180),
    int(b.break_minutes, 5, 0, 60),
    order,
    now,
    now,
  )
  return todos()
})

route.patch('/api/study/todos/:id', async (ctx) => {
  const id = int(ctx.params.id, 0)
  const row = get<Record<string, unknown>>('SELECT * FROM study_todos WHERE id = ?', id)
  if (!row) fail(404, '待办不存在')
  const b = await ctx.json()
  run(
    'UPDATE study_todos SET title = ?, duration_minutes = ?, break_minutes = ?, is_completed = ?, sort_order = ?, updated_at = ? WHERE id = ?',
    b.title !== undefined ? str(b.title, 200).trim() || String(row!.title) : String(row!.title),
    int(b.duration_minutes ?? row!.duration_minutes, 25, 1, 180),
    int(b.break_minutes ?? row!.break_minutes, 5, 0, 60),
    b.is_completed !== undefined ? bool(b.is_completed) : Number(row!.is_completed),
    int(b.sort_order ?? row!.sort_order, 0),
    nowIso(),
    id,
  )
  return todos()
})

route.delete('/api/study/todos/:id', (ctx) => {
  run('DELETE FROM study_todos WHERE id = ?', int(ctx.params.id, 0))
  return todos()
})

route.get('/api/study/schedule', (ctx) => {
  const date = isDateKey(ctx.query.get('date')) ? ctx.query.get('date')! : todayKey()
  return all('SELECT * FROM study_schedule WHERE date_key = ? ORDER BY start_time, id', date).map(toBool)
})

route.post('/api/study/schedule', async (ctx) => {
  const b = await ctx.json()
  const title = str(b.title, 200).trim()
  if (!title) fail(400, '日程需要一个名字')
  const date = isDateKey(b.date_key) ? b.date_key : todayKey()
  const start = TIME_RE.test(String(b.start_time)) ? String(b.start_time) : ''
  const end = TIME_RE.test(String(b.end_time)) ? String(b.end_time) : ''
  const now = nowIso()
  run(
    'INSERT INTO study_schedule(title, date_key, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    title,
    date,
    start,
    end,
    now,
    now,
  )
  return all('SELECT * FROM study_schedule WHERE date_key = ? ORDER BY start_time, id', date).map(toBool)
})

route.patch('/api/study/schedule/:id', async (ctx) => {
  const id = int(ctx.params.id, 0)
  const row = get<Record<string, unknown>>('SELECT * FROM study_schedule WHERE id = ?', id)
  if (!row) fail(404, '日程不存在')
  const b = await ctx.json()
  run(
    'UPDATE study_schedule SET title = ?, start_time = ?, end_time = ?, is_completed = ?, updated_at = ? WHERE id = ?',
    b.title !== undefined ? str(b.title, 200).trim() || String(row!.title) : String(row!.title),
    b.start_time !== undefined && TIME_RE.test(String(b.start_time)) ? String(b.start_time) : String(row!.start_time),
    b.end_time !== undefined && TIME_RE.test(String(b.end_time)) ? String(b.end_time) : String(row!.end_time),
    b.is_completed !== undefined ? bool(b.is_completed) : Number(row!.is_completed),
    nowIso(),
    id,
  )
  return all('SELECT * FROM study_schedule WHERE date_key = ? ORDER BY start_time, id', String(row!.date_key)).map(toBool)
})

route.delete('/api/study/schedule/:id', (ctx) => {
  const row = get<{ date_key: string }>('SELECT date_key FROM study_schedule WHERE id = ?', int(ctx.params.id, 0))
  run('DELETE FROM study_schedule WHERE id = ?', int(ctx.params.id, 0))
  return all('SELECT * FROM study_schedule WHERE date_key = ? ORDER BY start_time, id', row?.date_key || todayKey()).map(toBool)
})

/** 开始一次专注；同一 session_id 重复开始返回同一条。已有进行中的会话则拒绝，保证全局只有一个计时器。 */
route.post('/api/study/sessions', async (ctx) => {
  const b = await ctx.json()
  const sid = str(b.session_id, 64)
  if (!/^[\w-]{8,64}$/.test(sid)) fail(400, 'session_id 不合法')
  return tx(() => {
    const same = get('SELECT * FROM study_sessions WHERE session_id = ?', sid)
    if (same) return same
    const running = get<{ session_id: string; started_at: string; planned_minutes: number }>(
      "SELECT * FROM study_sessions WHERE status = 'running' LIMIT 1",
    )
    if (running) {
      // 超过计划时长两倍仍未结束的会话视为遗弃（比如关机了），自动收尾后允许开新的
      const age = Date.now() - Date.parse(running.started_at)
      if (age < running.planned_minutes * 60_000 * 2 + 60_000) fail(409, '已有一个正在进行的专注')
      run("UPDATE study_sessions SET status = 'abandoned', ended_at = ? WHERE session_id = ?", nowIso(), running.session_id)
    }
    const todoId = b.todo_id ? int(b.todo_id, 0) : null
    if (todoId && !get('SELECT 1 FROM study_todos WHERE id = ?', todoId)) fail(400, '绑定的待办不存在')
    const started = new Date()
    run(
      'INSERT INTO study_sessions(session_id, todo_id, date_key, started_at, planned_minutes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sid,
      todoId,
      dayKey(started),
      started.toISOString(),
      int(b.planned_minutes, 25, 1, 180),
      'running',
      nowIso(),
    )
    return get('SELECT * FROM study_sessions WHERE session_id = ?', sid)
  })
})

route.post('/api/study/sessions/:sid/finish', async (ctx) => {
  const b = await ctx.json()
  return tx(() => {
    const row = get<{ status: string; todo_id: number | null; started_at: string; planned_minutes: number }>(
      'SELECT * FROM study_sessions WHERE session_id = ?',
      ctx.params.sid,
    )
    if (!row) fail(404, '会话不存在')
    if (row!.status !== 'running') return get('SELECT * FROM study_sessions WHERE session_id = ?', ctx.params.sid)
    const elapsed = Math.floor((Date.now() - Date.parse(row!.started_at)) / 1000)
    const seconds = Math.min(int(b.focused_seconds, elapsed, 0), elapsed + 5)
    const completed = b.status !== 'abandoned' && seconds >= row!.planned_minutes * 60 - 5
    const status = b.status === 'abandoned' && seconds < 60 ? 'abandoned' : 'finished'
    const pomodoros = completed ? 1 : 0
    run(
      'UPDATE study_sessions SET status = ?, ended_at = ?, focused_seconds = ?, pomodoros = ? WHERE session_id = ?',
      status,
      nowIso(),
      seconds,
      pomodoros,
      ctx.params.sid,
    )
    if (pomodoros && row!.todo_id) {
      run('UPDATE study_todos SET completed_pomodoros = completed_pomodoros + 1, updated_at = ? WHERE id = ?', nowIso(), row!.todo_id)
    }
    return get('SELECT * FROM study_sessions WHERE session_id = ?', ctx.params.sid)
  })
})

route.get('/api/study/trend', (ctx) => {
  const days = int(ctx.query.get('days'), 30, 7, 400)
  const to = todayKey()
  const from = addDays(to, -(days - 1))
  const rows = all<{ date: string; seconds: number; pomodoros: number }>(
    `SELECT date_key date, SUM(focused_seconds) seconds, SUM(pomodoros) pomodoros FROM study_sessions
     WHERE status = 'finished' AND date_key BETWEEN ? AND ? GROUP BY date_key`,
    from,
    to,
  )
  const map = new Map(rows.map((r) => [r.date, r]))
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) || { date: d, seconds: 0, pomodoros: 0 })
  return out
})
