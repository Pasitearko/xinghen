// 品味库：收藏的链接与念头。images 是有序数组，第一张即封面。
import { all, get, parseJsonArray, run } from '../db.ts'
import { fail, int, route, str, tagList } from '../http.ts'
import { nowIso } from '../time.ts'
import { referencedImages, releaseImages } from './images.ts'

interface TasteRow {
  id: number
  legacy_id: string | null
  type: string
  title: string
  subtitle: string
  url: string
  images: string
  tags: string
  category: string
  note: string
  created_at: string
  updated_at: string
}

export interface TasteImage {
  url: string
  thumb?: string
  name?: string
  width?: number
  height?: number
}

function serialize(r: TasteRow) {
  return { ...r, images: parseJsonArray<TasteImage>(r.images), tags: parseJsonArray(r.tags) }
}

function cleanImages(v: unknown): TasteImage[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof x.url === 'string')
    .map((x) => ({
      url: str(x.url, 1000),
      thumb: str(x.thumb, 1000) || undefined,
      name: str(x.name, 200),
      width: int(x.width, 0, 0),
      height: int(x.height, 0, 0),
    }))
    .slice(0, 24)
}

function fields(body: Record<string, unknown>, base?: TasteRow) {
  const type = body.type !== undefined ? (body.type === 'note' ? 'note' : 'link') : base?.type || 'link'
  const out = {
    type,
    title: body.title !== undefined ? str(body.title, 300).trim() : base?.title || '',
    subtitle: body.subtitle !== undefined ? str(body.subtitle, 300) : base?.subtitle || '',
    url: body.url !== undefined ? str(body.url, 1000).trim() : base?.url || '',
    images: body.images !== undefined ? JSON.stringify(cleanImages(body.images)) : base?.images || '[]',
    tags: body.tags !== undefined ? JSON.stringify(tagList(body.tags)) : base?.tags || '[]',
    category: body.category !== undefined ? str(body.category, 60).trim() : base?.category || '',
    note: body.note !== undefined ? str(body.note, 100_000) : base?.note || '',
  }
  if (out.url && !/^https?:\/\//i.test(out.url)) out.url = `https://${out.url}`
  if (!out.title && !out.note && !out.url) fail(400, '至少写一个标题、链接或一段想法')
  return out
}

route.get('/api/taste', (ctx) => {
  const type = ctx.query.get('type')
  const q = str(ctx.query.get('q'), 100).trim()
  const tag = str(ctx.query.get('tag'), 30)
  const category = str(ctx.query.get('category'), 60)
  const where: string[] = []
  const args: string[] = []
  if (type === 'link' || type === 'note') {
    where.push('type = ?')
    args.push(type)
  }
  if (q) {
    where.push('(title LIKE ? OR subtitle LIKE ? OR note LIKE ? OR url LIKE ? OR tags LIKE ?)')
    const like = `%${q}%`
    args.push(like, like, like, like, like)
  }
  if (tag) {
    where.push('tags LIKE ?')
    args.push(`%"${tag.replace(/"/g, '')}"%`)
  }
  if (category) {
    where.push('category = ?')
    args.push(category)
  }
  const sql = `SELECT * FROM taste_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC`
  return all<TasteRow>(sql, ...args).map(serialize)
})

route.get('/api/taste/facets', () => {
  const tags = new Map<string, number>()
  const cats = new Map<string, number>()
  const types = { link: 0, note: 0 }
  for (const r of all<TasteRow>('SELECT type, tags, category FROM taste_items')) {
    types[r.type === 'note' ? 'note' : 'link']++
    for (const t of parseJsonArray(r.tags)) tags.set(t, (tags.get(t) || 0) + 1)
    if (r.category) cats.set(r.category, (cats.get(r.category) || 0) + 1)
  }
  const sort = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
  return { types, tags: sort(tags), categories: sort(cats), total: types.link + types.note }
})

route.post('/api/taste', async (ctx) => {
  const f = fields(await ctx.json())
  const now = nowIso()
  const id = run(
    `INSERT INTO taste_items(type, title, subtitle, url, images, tags, category, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.type,
    f.title,
    f.subtitle,
    f.url,
    f.images,
    f.tags,
    f.category,
    f.note,
    now,
    now,
  ).lastInsertRowid
  return serialize(get<TasteRow>('SELECT * FROM taste_items WHERE id = ?', Number(id))!)
})

route.patch('/api/taste/:id', async (ctx) => {
  const id = int(ctx.params.id, 0)
  const row = get<TasteRow>('SELECT * FROM taste_items WHERE id = ?', id)
  if (!row) fail(404, '这条收藏不存在')
  const f = fields(await ctx.json(), row)
  run(
    `UPDATE taste_items SET type = ?, title = ?, subtitle = ?, url = ?, images = ?, tags = ?, category = ?, note = ?, updated_at = ?
     WHERE id = ?`,
    f.type,
    f.title,
    f.subtitle,
    f.url,
    f.images,
    f.tags,
    f.category,
    f.note,
    nowIso(),
    id,
  )
  const dropped = referencedImages(row!.images).filter((name) => !f.images.includes(name))
  releaseImages(dropped)
  return serialize(get<TasteRow>('SELECT * FROM taste_items WHERE id = ?', id)!)
})

route.delete('/api/taste/:id', (ctx) => {
  const row = get<TasteRow>('SELECT * FROM taste_items WHERE id = ?', int(ctx.params.id, 0))
  if (!row) return undefined
  run('DELETE FROM taste_items WHERE id = ?', row.id)
  releaseImages(referencedImages(row.images))
  return undefined
})
