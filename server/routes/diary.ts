// 日记：一天可写多篇；只有「今天」可写，跨过本地午夜后自动封存为只读。
// 每篇带 version，保存时比对，防止另一个标签页的旧稿覆盖新内容。
import { randomUUID } from 'node:crypto'
import { all, get, parseJsonArray, run, tx } from '../db.ts'
import { fail, int, route, SENT, sendJson, str, tagList } from '../http.ts'
import { addDays, isDateKey, nowIso, todayKey } from '../time.ts'
import { referencedImages, releaseImages } from './images.ts'

interface DiaryRow {
  id: number
  identity: string
  version: number
  date_key: string
  entry_index: number
  title: string
  content_md: string
  weather: string
  mood: string
  tags: string
  char_count: number
  excerpt: string
  cover_url: string
  created_at: string
  updated_at: string
}

/** 去掉 Markdown 记号后数可见字符（中文一字一计，英文按字母计）。 */
export function plainText(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~`|]/g, '')
}

export function derive(md: string) {
  const plain = plainText(md)
  const chars = plain.replace(/\s+/g, '').length
  const excerpt = plain.replace(/\s+/g, ' ').trim().slice(0, 140)
  const cover = /!\[[^\]]*\]\(([^)\s]+)/.exec(md)?.[1] || ''
  return { char_count: chars, excerpt, cover_url: cover.slice(0, 1000) }
}

export function serialize(row: DiaryRow, today = todayKey()) {
  return { ...row, tags: parseJsonArray(row.tags), editable: row.date_key === today }
}

function byId(id: number) {
  return get<DiaryRow>('SELECT * FROM diary_entries WHERE id = ?', id)
}

route.get('/api/diary/day/:date', (ctx) => {
  const date = ctx.params.date === 'today' ? todayKey() : ctx.params.date
  if (!isDateKey(date)) fail(400, '日期格式应为 YYYY-MM-DD')
  const today = todayKey()
  const rows = all<DiaryRow>('SELECT * FROM diary_entries WHERE date_key = ? ORDER BY entry_index', date)
  const prev = get<{ d: string }>('SELECT MAX(date_key) d FROM diary_entries WHERE date_key < ?', date)?.d || null
  const next = get<{ d: string }>('SELECT MIN(date_key) d FROM diary_entries WHERE date_key > ?', date)?.d || null
  return {
    date,
    today,
    editable: date === today,
    entries: rows.map((r) => serialize(r, today)),
    prev,
    next,
  }
})

/** 日历/热力图用：每天的篇数与字数。 */
route.get('/api/diary/dates', (ctx) => {
  const to = isDateKey(ctx.query.get('to')) ? ctx.query.get('to')! : todayKey()
  const from = isDateKey(ctx.query.get('from')) ? ctx.query.get('from')! : addDays(to, -400)
  return all(
    `SELECT date_key AS date, COUNT(*) AS count, SUM(char_count) AS chars,
            MAX(mood) AS mood, MAX(weather) AS weather
     FROM diary_entries WHERE date_key BETWEEN ? AND ? GROUP BY date_key ORDER BY date_key`,
    from,
    to,
  )
})

const LIST_COLUMNS = 'id, identity, version, date_key, entry_index, title, weather, mood, tags, char_count, excerpt, cover_url, created_at, updated_at'

/** 档案室列表：按日期倒序分页，可按标签/心情筛选。 */
route.get('/api/diary/list', (ctx) => {
  const page = int(ctx.query.get('page'), 1, 1)
  const size = int(ctx.query.get('size'), 30, 1, 100)
  const tag = str(ctx.query.get('tag'), 30)
  const where = tag ? `WHERE tags LIKE ?` : ''
  const args = tag ? [`%"${tag.replace(/["%_]/g, '')}"%`] : []
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM diary_entries ${where}`, ...args)!.n
  // 列表只显示标题、摘要和字数，不读正文；排序走 (date_key, entry_index) 的唯一索引
  const rows = all<DiaryRow>(
    `SELECT ${LIST_COLUMNS} FROM diary_entries ${where} ORDER BY date_key DESC, entry_index DESC LIMIT ? OFFSET ?`,
    ...args,
    size,
    (page - 1) * size,
  )
  const today = todayKey()
  return { total, page, size, items: rows.map((r) => serialize(r, today)) }
})

route.get('/api/diary/search', (ctx) => {
  const q = str(ctx.query.get('q'), 100).trim()
  if (!q) return { q, items: [] }
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
  const rows = all<DiaryRow>(
    `SELECT * FROM diary_entries
     WHERE title LIKE ? ESCAPE '\\' OR content_md LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\'
     ORDER BY date_key DESC LIMIT 60`,
    like,
    like,
    like,
  )
  const today = todayKey()
  return {
    q,
    items: rows.map((r) => {
      const plain = plainText(r.content_md).replace(/\s+/g, ' ')
      const at = plain.toLowerCase().indexOf(q.toLowerCase())
      const snippet = at < 0 ? r.excerpt : plain.slice(Math.max(0, at - 40), at + q.length + 60)
      return { ...serialize(r, today), content_md: undefined, snippet }
    }),
  }
})

route.get('/api/diary/tags', () => {
  const counts = new Map<string, number>()
  for (const r of all<{ tags: string }>('SELECT tags FROM diary_entries')) {
    for (const t of parseJsonArray(r.tags)) counts.set(t, (counts.get(t) || 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }))
})

route.get('/api/diary/entry/:id', (ctx) => {
  const row = byId(int(ctx.params.id, 0))
  if (!row) fail(404, '这篇日记不存在')
  return serialize(row!)
})

route.post('/api/diary', async (ctx) => {
  const body = await ctx.json()
  const today = todayKey()
  const identity = str(body.identity, 36) || randomUUID()
  // 幂等：同一个 identity 重复提交（网络重试）直接返回已建的那篇
  const existing = get<DiaryRow>('SELECT * FROM diary_entries WHERE identity = ?', identity)
  if (existing) return serialize(existing, today)
  if (body.date_key && body.date_key !== today) fail(403, '只能为今天新建日记')
  const content = str(body.content_md, 500_000)
  const now = nowIso()
  const id = tx(() => {
    const next = (get<{ n: number }>('SELECT COALESCE(MAX(entry_index), 0) + 1 n FROM diary_entries WHERE date_key = ?', today)!.n)
    const d = derive(content)
    return run(
      `INSERT INTO diary_entries(identity, version, date_key, entry_index, title, content_md, weather, mood, tags,
        char_count, excerpt, cover_url, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      identity,
      today,
      next,
      str(body.title, 300),
      content,
      str(body.weather, 30),
      str(body.mood, 30),
      JSON.stringify(tagList(body.tags)),
      d.char_count,
      d.excerpt,
      d.cover_url,
      now,
      now,
    ).lastInsertRowid
  })
  return serialize(byId(Number(id))!, today)
})

route.patch('/api/diary/:id', async (ctx) => {
  const id = int(ctx.params.id, 0)
  const body = await ctx.json()
  const row = byId(id)
  if (!row) fail(404, '这篇日记已被删除')
  const today = todayKey()
  if (row!.date_key !== today) fail(403, '这一天已封存，只能阅读')
  if (int(body.version, -1) !== row!.version) {
    sendJson(ctx.res, 409, { detail: '这篇日记已在别的窗口修改过', current: serialize(row!, today) })
    return SENT
  }
  const next = {
    title: body.title !== undefined ? str(body.title, 300) : row!.title,
    content_md: body.content_md !== undefined ? str(body.content_md, 500_000) : row!.content_md,
    weather: body.weather !== undefined ? str(body.weather, 30) : row!.weather,
    mood: body.mood !== undefined ? str(body.mood, 30) : row!.mood,
    tags: body.tags !== undefined ? JSON.stringify(tagList(body.tags)) : row!.tags,
  }
  const d = derive(next.content_md)
  run(
    `UPDATE diary_entries SET version = version + 1, title = ?, content_md = ?, weather = ?, mood = ?, tags = ?,
       char_count = ?, excerpt = ?, cover_url = ?, updated_at = ? WHERE id = ? AND version = ?`,
    next.title,
    next.content_md,
    next.weather,
    next.mood,
    next.tags,
    d.char_count,
    d.excerpt,
    d.cover_url,
    nowIso(),
    id,
    row!.version,
  )
  // 正文里删掉的图不立刻清理（可能马上撤销），只在整篇删除时回收。
  return serialize(byId(id)!, today)
})

route.delete('/api/diary/:id', (ctx) => {
  const row = byId(int(ctx.params.id, 0))
  if (!row) return undefined
  run('DELETE FROM diary_entries WHERE id = ?', row.id)
  releaseImages(referencedImages(row.content_md))
  return undefined
})

route.get('/api/diary/stats', () => {
  const totals = get<{ entries: number; chars: number; days: number }>(
    'SELECT COUNT(*) entries, COALESCE(SUM(char_count), 0) chars, COUNT(DISTINCT date_key) days FROM diary_entries',
  )!
  const days = new Set(all<{ d: string }>('SELECT DISTINCT date_key d FROM diary_entries').map((r) => r.d))
  // 连续天数：从今天（今天没写则从昨天）往回数
  let cursor = todayKey()
  if (!days.has(cursor)) cursor = addDays(cursor, -1)
  let streak = 0
  while (days.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  let longest = 0
  let run_ = 0
  let prev = ''
  for (const d of [...days].sort()) {
    run_ = prev && addDays(prev, 1) === d ? run_ + 1 : 1
    longest = Math.max(longest, run_)
    prev = d
  }
  const first = get<{ d: string }>('SELECT MIN(date_key) d FROM diary_entries')?.d || null
  return { ...totals, streak, longest_streak: longest, first_date: first }
})
