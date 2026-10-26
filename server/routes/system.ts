// 资讯与备份的 HTTP 接口。
import { join } from 'node:path'
import { applyBundle, exportMarkdown, exportZip, listBackups, parseUpload } from '../backup.ts'
import { run } from '../db.ts'
import { fail, route, sendFile } from '../http.ts'
import { feed, refreshAll, SOURCES, sourceList } from '../news.ts'
import { BACKUP_DIR, DATA_DIR, MUSIC_DIR } from '../paths.ts'
import { TZ } from '../time.ts'

route.get('/api/news/feed', () => feed())
route.get('/api/news/sources', () => sourceList())
route.post('/api/news/refresh', async () => {
  const results = await refreshAll()
  return { results, ...feed() }
})
route.patch('/api/news/sources/:key', async (ctx) => {
  if (!SOURCES.some((s) => s.key === ctx.params.key)) fail(404, '没有这个来源')
  const b = await ctx.json()
  run('UPDATE news_sources SET enabled = ? WHERE key = ?', b.enabled ? 1 : 0, ctx.params.key)
  return sourceList()
})
route.get('/api/backup', () => ({ dir: BACKUP_DIR, data_dir: DATA_DIR, music_dir: MUSIC_DIR, timezone: TZ, items: listBackups() }))
route.post('/api/backup/export', () => {
  const out = exportZip()
  return { name: out.name, size: out.size, counts: out.manifest.counts }
})
route.post('/api/backup/export-markdown', () => {
  const out = exportMarkdown()
  return { name: out.name, size: out.size, count: out.count }
})
route.get('/api/backup/download/:name', (ctx) => {
  const name = ctx.params.name
  if (!/^[\w.-]+\.zip$/.test(name)) fail(404, '没有这个备份')
  return sendFile(ctx.req, ctx.res, join(BACKUP_DIR, name), { download: name, type: 'application/zip' })
})
/** 先 ?dry=1 预览会新增/跳过多少，确认后再正式导入。 */
route.post('/api/backup/import', async (ctx) => {
  const buf = await ctx.body(600 * 1024 * 1024)
  if (!buf.length) fail(400, '没有收到文件')
  const bundle = parseUpload(buf, ctx.query.get('name') || '')
  return applyBundle(bundle, ctx.query.get('dry') === '1')
})
