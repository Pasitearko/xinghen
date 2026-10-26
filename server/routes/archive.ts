// 档案室：跨模块的统计与回顾。
import { all, get } from '../db.ts'
import { int, route } from '../http.ts'
import { addDays, todayKey } from '../time.ts'

route.get('/api/archive/overview', () => {
  const diary = get<{ entries: number; chars: number; days: number }>(
    'SELECT COUNT(*) entries, COALESCE(SUM(char_count), 0) chars, COUNT(DISTINCT date_key) days FROM diary_entries',
  )!
  const taste = get<{ n: number }>('SELECT COUNT(*) n FROM taste_items')!.n
  const study = get<{ seconds: number; pomodoros: number; sessions: number }>(
    "SELECT COALESCE(SUM(focused_seconds), 0) seconds, COALESCE(SUM(pomodoros), 0) pomodoros, COUNT(*) sessions FROM study_sessions WHERE status = 'finished'",
  )!
  const images = get<{ n: number; bytes: number }>('SELECT COUNT(*) n, COALESCE(SUM(file_size), 0) bytes FROM image_assets')!
  const today = todayKey()
  const month = today.slice(0, 7)
  const thisMonth = get<{ entries: number; chars: number }>(
    "SELECT COUNT(*) entries, COALESCE(SUM(char_count), 0) chars FROM diary_entries WHERE substr(date_key, 1, 7) = ?",
    month,
  )!
  const moods = all<{ mood: string; n: number }>(
    "SELECT mood, COUNT(*) n FROM diary_entries WHERE mood <> '' GROUP BY mood ORDER BY n DESC LIMIT 8",
  )
  const weathers = all<{ weather: string; n: number }>(
    "SELECT weather, COUNT(*) n FROM diary_entries WHERE weather <> '' GROUP BY weather ORDER BY n DESC LIMIT 8",
  )
  // 最近 12 个自然月（含本月），避免首尾出现两个同名的「10月」
  const [y, m] = month.split('-').map(Number)
  const since = `${m === 12 ? y : y - 1}-${String((m % 12) + 1).padStart(2, '0')}-01`
  const byMonth = all<{ month: string; entries: number; chars: number }>(
    `SELECT substr(date_key, 1, 7) month, COUNT(*) entries, SUM(char_count) chars FROM diary_entries
     WHERE date_key >= ? GROUP BY month ORDER BY month`,
    since,
  )
  return { diary, taste, study, images, thisMonth, moods, weathers, byMonth }
})

/** 一年的写作热力图：每天字数。 */
route.get('/api/archive/heatmap', (ctx) => {
  const days = int(ctx.query.get('days'), 371, 30, 800)
  const to = todayKey()
  const from = addDays(to, -(days - 1))
  const rows = all<{ date: string; chars: number; count: number }>(
    'SELECT date_key date, SUM(char_count) chars, COUNT(*) count FROM diary_entries WHERE date_key BETWEEN ? AND ? GROUP BY date_key',
    from,
    to,
  )
  const focus = all<{ date: string; seconds: number }>(
    "SELECT date_key date, SUM(focused_seconds) seconds FROM study_sessions WHERE status = 'finished' AND date_key BETWEEN ? AND ? GROUP BY date_key",
    from,
    to,
  )
  return { from, to, diary: rows, focus }
})

/** 「那年今日」：往年同一天写过的日记。 */
route.get('/api/archive/on-this-day', () => {
  const today = todayKey()
  return all(
    "SELECT id, date_key, title, excerpt, char_count FROM diary_entries WHERE substr(date_key, 6) = ? AND date_key < ? ORDER BY date_key DESC",
    today.slice(5),
    today,
  )
})
