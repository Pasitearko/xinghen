// 个人资料、壁纸与跨设备无关的偏好（存在库里，换浏览器也不丢）。
import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { all, get, kvGet, kvSet, run } from '../db.ts'
import { fail, route, sendFile, str } from '../http.ts'
import { WALLPAPER_PRESETS } from '../paths.ts'
import { nowIso, todayKey } from '../time.ts'
import { referencedImages, releaseImages } from './images.ts'

function profile() {
  return (
    get('SELECT name, motto, avatar_url, updated_at FROM profile WHERE id = 1') || {
      name: '',
      motto: '',
      avatar_url: '',
      updated_at: null,
    }
  )
}

route.get('/api/profile', () => profile())

route.put('/api/profile', async (ctx) => {
  const b = await ctx.json()
  const before = profile() as { avatar_url: string }
  const avatar = str(b.avatar_url, 500)
  run(
    `INSERT INTO profile(id, name, motto, avatar_url, updated_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, motto = excluded.motto, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`,
    str(b.name, 60).trim(),
    str(b.motto, 200).trim(),
    avatar,
    nowIso(),
  )
  if (before.avatar_url && before.avatar_url !== avatar) releaseImages(referencedImages(before.avatar_url))
  return profile()
})

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])

function presets() {
  try {
    return readdirSync(WALLPAPER_PRESETS)
      .filter((f) => IMG_EXT.has(extname(f).toLowerCase()))
      .sort()
      .map((f) => ({ id: `preset:${f}`, url: `/api/wallpapers/preset/${encodeURIComponent(f)}`, name: f.replace(/\.\w+$/, ''), kind: 'preset' }))
  } catch {
    return []
  }
}

function uploaded() {
  return all<{ filename: string; url: string; original_name: string }>(
    "SELECT filename, url, original_name FROM image_assets WHERE scope = 'wallpaper' ORDER BY id DESC",
  ).map((r) => ({ id: `upload:${r.filename}`, url: r.url, name: r.original_name || r.filename, kind: 'upload' }))
}

route.get('/api/wallpapers', () => ({
  items: [...presets(), ...uploaded()],
  selected: kvGet('wallpaper', { dark: 'sky', light: 'sky' }),
}))

route.put('/api/wallpapers/selected', async (ctx) => {
  const b = await ctx.json<{ dark?: string; light?: string }>()
  const ids = new Set(['sky', ...presets().map((p) => p.id), ...uploaded().map((u) => u.id)])
  const current = kvGet('wallpaper', { dark: 'sky', light: 'sky' })
  const next = {
    dark: b.dark && ids.has(b.dark) ? b.dark : current.dark,
    light: b.light && ids.has(b.light) ? b.light : current.light,
  }
  kvSet('wallpaper', next)
  return next
})

route.delete('/api/wallpapers/upload/:filename', (ctx) => {
  const sel = kvGet('wallpaper', { dark: 'sky', light: 'sky' })
  const id = `upload:${ctx.params.filename}`
  kvSet('wallpaper', { dark: sel.dark === id ? 'sky' : sel.dark, light: sel.light === id ? 'sky' : sel.light })
  releaseImages([ctx.params.filename])
  return undefined
})

route.get('/api/wallpapers/preset/:name', (ctx) => {
  const name = ctx.params.name
  if (!/^[\w.-]+$/.test(name) || !IMG_EXT.has(extname(name).toLowerCase())) fail(404, '没有这张壁纸')
  return sendFile(ctx.req, ctx.res, join(WALLPAPER_PRESETS, name), { cache: 'public, max-age=86400' })
})

route.get('/api/health', () => ({ ok: true, app: 'xinghen', pid: process.pid, today: todayKey(), started_at: STARTED }))
const STARTED = nowIso()
