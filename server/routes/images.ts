// 图片附件：前端以原始二进制上传（不走 multipart），落盘到 uploads/<scope>/。
import { randomBytes } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { all, get, run } from '../db.ts'
import { fail, route, sendFile } from '../http.ts'
import { UPLOAD_DIR, UPLOAD_SCOPES } from '../paths.ts'
import { nowIso } from '../time.ts'

export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
}
const MAX_IMAGE = 20 * 1024 * 1024
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,200}$/

export const IMAGE_URL_PREFIX = '/api/images/'

export function imagePath(scope: string, filename: string) {
  if (!(UPLOAD_SCOPES as readonly string[]).includes(scope) || !SAFE_NAME.test(filename) || filename.startsWith('.')) {
    return null
  }
  return join(UPLOAD_DIR, scope, filename)
}

export function saveImage(scope: string, content: Buffer, mime: string, originalName = '') {
  const ext = IMAGE_TYPES[mime]
  if (!ext) fail(415, `不支持的图片类型：${mime || '未知'}`)
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const filename = `${scope}-${stamp}-${randomBytes(4).toString('hex')}${ext}`
  const path = imagePath(scope, filename)!
  writeFileSync(path, content, { flag: 'wx' })
  return registerImage(scope, filename, originalName || filename, content.length, mime)
}

export function registerImage(scope: string, filename: string, originalName: string, size: number, mime: string) {
  const url = IMAGE_URL_PREFIX + filename
  run(
    `INSERT INTO image_assets(filename, original_name, url, scope, file_size, mime_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(filename) DO NOTHING`,
    filename,
    originalName.slice(0, 200),
    url,
    scope,
    size,
    mime,
    nowIso(),
  )
  return get<{ id: number; filename: string; url: string; scope: string; file_size: number; mime_type: string }>(
    'SELECT id, filename, url, scope, file_size, mime_type FROM image_assets WHERE filename = ?',
    filename,
  )!
}

/** 正文/条目里引用的本机图片文件名。 */
export function referencedImages(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\/api\/images\/([A-Za-z0-9_.-]+)/g)) out.add(m[1])
  return [...out]
}

/** 删除条目后，清掉不再被任何内容引用的图片（只删登记过的文件）。 */
export function releaseImages(filenames: string[]) {
  for (const filename of filenames) {
    const like = `%${IMAGE_URL_PREFIX}${filename}%`
    const used =
      get('SELECT 1 FROM diary_entries WHERE content_md LIKE ? LIMIT 1', like) ||
      get('SELECT 1 FROM taste_items WHERE images LIKE ? LIMIT 1', like) ||
      get('SELECT 1 FROM profile WHERE avatar_url LIKE ? LIMIT 1', like) ||
      get('SELECT 1 FROM kv WHERE value LIKE ? LIMIT 1', like)
    if (used) continue
    const row = get<{ scope: string }>('SELECT scope FROM image_assets WHERE filename = ?', filename)
    if (!row) continue
    const path = imagePath(row.scope, filename)
    if (path) rmSync(path, { force: true })
    run('DELETE FROM image_assets WHERE filename = ?', filename)
  }
}

export function findImageFile(filename: string) {
  const row = get<{ scope: string; mime_type: string }>('SELECT scope, mime_type FROM image_assets WHERE filename = ?', filename)
  if (row) {
    const p = imagePath(row.scope, filename)
    if (p && existsSync(p)) return { path: p, mime: row.mime_type }
  }
  for (const scope of UPLOAD_SCOPES) {
    const p = imagePath(scope, filename)
    if (p && existsSync(p)) return { path: p, mime: '' }
  }
  return null
}

route.post('/api/images', async (ctx) => {
  const scope = ctx.query.get('scope') || 'diary'
  if (!['taste', 'diary', 'avatar', 'wallpaper'].includes(scope)) fail(400, 'scope 不合法')
  const mime = String(ctx.req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const body = await ctx.body(MAX_IMAGE)
  if (!body.length) fail(400, '空文件')
  return saveImage(scope, body, mime, ctx.query.get('name') || '')
})

route.get('/api/images', (ctx) => {
  const scope = ctx.query.get('scope')
  return scope
    ? all('SELECT id, filename, url, scope, file_size, mime_type, created_at FROM image_assets WHERE scope = ? ORDER BY id DESC', scope)
    : all('SELECT id, filename, url, scope, file_size, mime_type, created_at FROM image_assets ORDER BY id DESC')
})

route.get('/api/images/:filename', (ctx) => {
  const found = findImageFile(ctx.params.filename)
  if (!found) fail(404, '图片不存在')
  // 文件名带随机串、内容不变，可以长期缓存
  return sendFile(ctx.req, ctx.res, found!.path, { cache: 'public, max-age=31536000, immutable', type: found!.mime || undefined })
})
