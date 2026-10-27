// 备份与迁移。
// - 导出：ZIP（manifest.json + tables.json + attachments/<scope>/<file>），每天自动备份一份，保留最近 7 份；
// - 导入：本版导出的 ZIP、旧版的 v4 ZIP、另一份数据目录（xinghen.db 或旧版的 feixing.db + uploads/）、
//   更早的旧站 JSON（扁平日记 / {diary, taste}）。导入是「合并」：已存在的条目跳过，不覆盖现有内容。
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import { strToU8, unzipSync, type Zippable } from 'fflate'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { all, get, kvGet, kvSet, parseJsonArray, run, tx } from './db.ts'
import { HttpError } from './http.ts'
import { BACKUP_DIR, UPLOAD_SCOPES } from './paths.ts'
import { derive } from './routes/diary.ts'
import { IMAGE_TYPES, imagePath, registerImage } from './routes/images.ts'
import { isDateKey, nowIso, todayKey } from './time.ts'

export const FORMAT_VERSION = 5
const TABLES = ['diary_entries', 'taste_items', 'image_assets', 'study_todos', 'study_schedule', 'study_sessions', 'profile', 'kv'] as const

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

// ---------------- 导出 ----------------
/** 压缩放到临时的后台线程里做（见 zip-worker.ts），主线程照常响应写日记、放歌这些请求 */
function zipAsync(files: Zippable) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const w = new Worker(new URL('./zip-worker.ts', import.meta.url))
    w.once('message', (out: Uint8Array) => {
      resolve(out)
      void w.terminate()
    })
    w.once('error', reject)
    w.once('exit', (code) => code !== 0 && reject(new Error(`压缩线程异常退出（${code}）`)))
    w.postMessage(files)
  })
}

/** 先写临时文件再改名，备份文件要么完整、要么不存在 */
async function writeAtomic(target: string, data: Uint8Array) {
  await writeFile(`${target}.tmp`, data)
  await rename(`${target}.tmp`, target)
}

let exporting: ReturnType<typeof doExport> | null = null

/** 同一时间只做一份完整备份：连点几次「导出」或碰上自动备份，都等同一份 */
export function exportZip(prefix = 'xinghen-backup') {
  exporting ??= doExport(prefix).finally(() => (exporting = null))
  return exporting
}

async function doExport(prefix: string) {
  // 表一次性同步读完，拿到的是同一时刻的快照；之后的读图、压缩、写盘都是异步的
  const tables: Tables = {}
  for (const t of TABLES) tables[t] = all(`SELECT * FROM ${t}`)
  const files: Zippable = {}
  const attachments: string[] = []
  for (const img of tables.image_assets as { scope: string; filename: string }[]) {
    const p = imagePath(img.scope, img.filename)
    const data = p ? await readFile(p).catch(() => null) : null
    if (data) {
      // 图片本身已压缩，不再 deflate，导出快很多
      files[`attachments/${img.scope}/${img.filename}`] = [data, { level: 0 }]
      attachments.push(`${img.scope}/${img.filename}`)
    }
  }
  const tablesJson = strToU8(JSON.stringify(tables))
  const manifest = {
    app: 'xinghen',
    version: FORMAT_VERSION,
    platform: 'linux',
    created_at: nowIso(),
    counts: Object.fromEntries(TABLES.map((t) => [t, tables[t].length])),
    attachments: attachments.length,
    sha256: createHash('sha256').update(tablesJson).digest('hex'),
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  files['tables.json'] = tablesJson
  const out = await zipAsync(files)
  const name = `${prefix}-${stamp()}.zip`
  const target = join(BACKUP_DIR, name)
  await writeAtomic(target, out)
  return { name, path: target, size: out.length, manifest }
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)
}

export async function exportMarkdown() {
  const rows = all<Row>('SELECT * FROM diary_entries ORDER BY date_key, entry_index')
  const files: Zippable = {}
  for (const r of rows) {
    const tags = parseJsonArray(r.tags)
    const head = [
      '---',
      `date: ${r.date_key}`,
      `title: ${JSON.stringify(r.title || '')}`,
      r.weather ? `weather: ${r.weather}` : '',
      r.mood ? `mood: ${r.mood}` : '',
      tags.length ? `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]` : '',
      `words: ${r.char_count}`,
      '---',
      '',
    ].filter(Boolean)
    const year = String(r.date_key).slice(0, 4)
    const name = `${year}/${r.date_key}-${r.entry_index}${r.title ? '-' + safeName(String(r.title)) : ''}.md`
    files[name] = strToU8(`${head.join('\n')}\n${r.title ? `# ${r.title}\n\n` : ''}${r.content_md}\n`)
  }
  const out = await zipAsync(files)
  const name = `xinghen-diary-markdown-${stamp()}.zip`
  const target = join(BACKUP_DIR, name)
  await writeAtomic(target, out)
  return { name, path: target, size: out.length, count: rows.length }
}

export function listBackups() {
  try {
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => {
        const st = statSync(join(BACKUP_DIR, f))
        return { name: f, size: st.size, created_at: st.mtime.toISOString(), auto: f.startsWith('xinghen-auto') }
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  } catch {
    return []
  }
}

/** 每天第一次启动时自动备份，只保留最近 7 份自动备份。 */
export async function autoBackup() {
  const last = kvGet<string>('backup.auto_day', '')
  const hasData = get<{ n: number }>('SELECT (SELECT COUNT(*) FROM diary_entries) + (SELECT COUNT(*) FROM taste_items) n')!.n
  if (last === todayKey() || !hasData) return null
  const out = await exportZip('xinghen-auto')
  kvSet('backup.auto_day', todayKey())
  const autos = listBackups().filter((b) => b.auto)
  for (const old of autos.slice(7)) rmSync(join(BACKUP_DIR, old.name), { force: true })
  return out
}

// ---------------- 解析各种输入 ----------------
interface Bundle {
  kind: string
  tables: Tables
  /** "scope/filename" → 内容 */
  files: Map<string, Uint8Array>
  notes: string[]
}

const textDecoder = new TextDecoder()

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  return parseJsonArray(v)
}

/** 旧库的时间可能是无时区的 'YYYY-MM-DD HH:MM:SS'（UTC），统一成 ISO。 */
function iso(v: unknown, fallback = nowIso()) {
  if (typeof v === 'number') return new Date(v > 1e11 ? v : v * 1000).toISOString()
  if (typeof v !== 'string' || !v) return fallback
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`
  const t = Date.parse(s)
  return Number.isNaN(t) ? fallback : new Date(t).toISOString()
}

function fromZip(buf: Uint8Array): Bundle {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(buf, { filter: (f) => f.originalSize < 512 * 1024 * 1024 })
  } catch {
    throw new HttpError(400, '这个 ZIP 文件损坏或不是星痕备份')
  }
  const manifest = entries['manifest.json'] ? JSON.parse(textDecoder.decode(entries['manifest.json'])) : null
  const files = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(entries)) {
    const m = /^attachments\/([a-z]+)\/([A-Za-z0-9_.-]+)$/.exec(name)
    if (m && (UPLOAD_SCOPES as readonly string[]).includes(m[1])) files.set(`${m[1]}/${m[2]}`, data)
  }
  if (entries['tables.json']) {
    const tables = JSON.parse(textDecoder.decode(entries['tables.json'])) as Tables
    return { kind: manifest?.version >= 5 ? 'xinghen' : 'legacy-v4', tables, files, notes: [] }
  }
  // 更早的旧版 ZIP：只有 diary.json / taste_items.json
  const tables: Tables = {}
  if (entries['diary.json']) tables.diary_entries = JSON.parse(textDecoder.decode(entries['diary.json']))
  if (entries['taste_items.json']) tables.taste_items = JSON.parse(textDecoder.decode(entries['taste_items.json']))
  if (!tables.diary_entries && !tables.taste_items) throw new HttpError(400, 'ZIP 里没有找到星痕的数据文件（tables.json）')
  return { kind: 'legacy-zip', tables, files, notes: [] }
}

function fromLegacyJson(value: unknown): Bundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'JSON 顶层不是对象')
  const obj = value as Record<string, unknown>
  const diaries: Row[] = []
  const taste: Row[] = []
  const notes: string[] = []
  const pushDiary = (key: string, v: unknown) => {
    if (!isDateKey(key) || !v || typeof v !== 'object') return
    const d = v as Record<string, unknown>
    let content = String(d.content ?? '')
    if (!content && Array.isArray(d.images)) {
      content = d.images.map((img: Record<string, unknown>) => `![${img?.name || '图片'}](${img?.dataUrl || img?.url || ''})`).join('\n')
    }
    diaries.push({
      date_key: key,
      title: d.title ?? '',
      content_md: content,
      weather: d.weather ?? '',
      mood: d.mood ?? '',
      tags: Array.isArray(d.tags) ? d.tags : String(d.tags || '').split(/[、,，/]/),
      created_at: d.createdAt,
    })
  }
  if (!('diary' in obj) && !('taste' in obj) && !('trash' in obj)) {
    for (const [k, v] of Object.entries(obj)) pushDiary(k, v)
    if (!diaries.length) throw new HttpError(400, '没认出这个 JSON：既不是星痕备份，也不像旧站的日记备份')
    return { kind: 'legacy-diary-json', tables: { diary_entries: diaries }, files: new Map(), notes }
  }
  if (obj.diary && typeof obj.diary === 'object') for (const [k, v] of Object.entries(obj.diary)) pushDiary(k, v)
  const items = (obj.taste as { items?: unknown[] } | undefined)?.items
  if (Array.isArray(items)) {
    for (const it of items as Record<string, unknown>[]) {
      if (!it || typeof it !== 'object') continue
      taste.push({
        legacy_id: it.id ? String(it.id) : null,
        type: it.type === 'note' ? 'note' : 'link',
        title: it.title ?? '',
        subtitle: it.subtitle ?? '',
        url: it.url ?? '',
        images: (Array.isArray(it.images) ? it.images : [])
          .map((img: Record<string, unknown>) => ({ url: img?.dataUrl || img?.url || '', name: img?.name || '' }))
          .filter((img) => img.url),
        tags: it.tags ?? [],
        category: it.category ?? '',
        note: it.note ?? '',
        created_at: it.createdAt,
      })
    }
  }
  if (Array.isArray(obj.trash) && obj.trash.length) notes.push(`垃圾桶里的 ${obj.trash.length} 条不会导入`)
  return { kind: 'legacy-mixed-json', tables: { diary_entries: diaries, taste_items: taste }, files: new Map(), notes }
}

/** 另一份数据目录：里面有 xinghen.db（或旧版的 feixing.db）与 uploads/；也可以直接给数据库文件。 */
export function fromOldDataDir(dir: string): Bundle {
  const dbFile = ['xinghen.db', 'feixing.db'].map((f) => join(dir, f)).find((f) => existsSync(f)) || dir
  if (!existsSync(dbFile)) throw new HttpError(400, `找不到 ${dbFile}`)
  const old = new DatabaseSync(dbFile, { readOnly: true })
  const tables: Tables = {}
  try {
    const names = new Set((old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name))
    for (const t of ['diary_entries', 'taste_items', 'image_assets', 'uploaded_images', 'study_todos', 'study_schedule', 'study_sessions', 'profile']) {
      if (names.has(t)) tables[t] = old.prepare(`SELECT * FROM ${t}`).all() as Row[]
    }
  } finally {
    old.close()
  }
  const files = new Map<string, Uint8Array>()
  const uploads = join(dirname(dbFile), 'uploads')
  for (const scope of UPLOAD_SCOPES) {
    const sd = join(uploads, scope)
    if (!existsSync(sd)) continue
    for (const f of readdirSync(sd)) if (/^[A-Za-z0-9_.-]+$/.test(f)) files.set(`${scope}/${f}`, readFileSync(join(sd, f)))
  }
  return { kind: 'data-dir', tables, files, notes: [] }
}

export function parseUpload(buf: Buffer, filename = ''): Bundle {
  if (buf[0] === 0x50 && buf[1] === 0x4b) return fromZip(buf)
  if (buf.subarray(0, 15).toString('latin1') === 'SQLite format 3') {
    const tmp = join(BACKUP_DIR, `.import-${randomUUID()}.db`)
    writeFileSync(tmp, buf)
    try {
      const b = fromOldDataDir(tmp)
      b.notes.push('只上传了数据库文件，附件图片需要把整个旧数据目录用命令行导入')
      return b
    } finally {
      rmSync(tmp, { force: true })
    }
  }
  let value: unknown
  try {
    value = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''))
  } catch {
    throw new HttpError(400, `${filename || '文件'} 不是 ZIP、SQLite 或 JSON`)
  }
  return fromLegacyJson(value)
}

// ---------------- 合并导入 ----------------
const fixUrl = (s: string) => s.replaceAll('/api/v1/images/', '/api/images/')

function digest(...parts: unknown[]) {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('\x1f')).digest('hex').slice(0, 24)
}

/** data:URL 内联图（旧站）落成本机文件，换机器也不丢图。 */
function materialize(url: string, scope: string, dry: boolean, counter: { n: number }) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(url)
  if (!m || !IMAGE_TYPES[m[1]]) return url
  counter.n++
  if (dry) return url
  const content = Buffer.from(m[2], 'base64')
  const filename = `${scope}-legacy-${createHash('sha1').update(content).digest('hex').slice(0, 16)}${IMAGE_TYPES[m[1]]}`
  const p = imagePath(scope, filename)!
  if (!existsSync(p)) writeFileSync(p, content)
  return registerImage(scope, filename, filename, content.length, m[1]).url
}

export interface ImportReport {
  kind: string
  dry: boolean
  diaries: { added: number; skipped: number }
  taste: { added: number; skipped: number }
  study: { added: number; skipped: number }
  images: { added: number; skipped: number; inline: number }
  profile: boolean
  notes: string[]
}

export function applyBundle(b: Bundle, dry: boolean): ImportReport {
  const r: ImportReport = {
    kind: b.kind,
    dry,
    diaries: { added: 0, skipped: 0 },
    taste: { added: 0, skipped: 0 },
    study: { added: 0, skipped: 0 },
    images: { added: 0, skipped: 0, inline: 0 },
    profile: false,
    notes: [...b.notes],
  }
  const inline = { n: 0 }
  const now = nowIso()

  const work = () => {
    // 1. 图片附件
    const assets = [
      ...(b.tables.image_assets || []),
      ...(b.tables.uploaded_images || []).map((x) => ({ ...x, scope: 'images' })),
    ] as { scope: string; filename: string; original_name?: string; mime_type?: string; file_size?: number }[]
    const known = new Set(assets.map((a) => `${a.scope}/${a.filename}`))
    for (const key of b.files.keys()) {
      if (!known.has(key)) {
        const [scope, filename] = key.split('/')
        assets.push({ scope, filename })
      }
    }
    for (const a of assets) {
      const data = b.files.get(`${a.scope}/${a.filename}`)
      const p = imagePath(a.scope, a.filename)
      if (!p || !data) continue
      if (get('SELECT 1 FROM image_assets WHERE filename = ?', a.filename)) {
        r.images.skipped++
        continue
      }
      r.images.added++
      if (dry) continue
      if (!existsSync(p)) writeFileSync(p, data)
      const ext = a.filename.slice(a.filename.lastIndexOf('.')).toLowerCase()
      const mime = a.mime_type || Object.entries(IMAGE_TYPES).find(([, e]) => e === ext || (ext === '.jpeg' && e === '.jpg'))?.[0] || ''
      registerImage(a.scope, a.filename, a.original_name || a.filename, a.file_size || data.length, mime)
    }

    // 2. 日记：identity 相同或（日期+标题+正文）相同视为已存在
    const diaries = [...(b.tables.diary_entries || [])].sort((x, y) =>
      `${x.date_key}|${String(x.entry_index ?? 0).padStart(4, '0')}`.localeCompare(`${y.date_key}|${String(y.entry_index ?? 0).padStart(4, '0')}`),
    )
    const existingDigests = new Set(all<Row>('SELECT date_key, title, content_md FROM diary_entries').map((d) => digest(d.date_key, d.title, d.content_md)))
    for (const d of diaries) {
      if (!isDateKey(d.date_key)) continue
      const content = materialize(fixUrl(String(d.content_md ?? '')), 'diary', dry, inline).replace(
        /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g,
        (_, alt, url) => `![${alt}](${materialize(url, 'diary', dry, inline)})`,
      )
      const identity = typeof d.identity === 'string' && d.identity ? d.identity : null
      const dg = digest(d.date_key, d.title ?? '', content)
      if ((identity && get('SELECT 1 FROM diary_entries WHERE identity = ?', identity)) || existingDigests.has(dg)) {
        r.diaries.skipped++
        continue
      }
      existingDigests.add(dg)
      r.diaries.added++
      if (dry) continue
      const idx = get<{ n: number }>('SELECT COALESCE(MAX(entry_index), 0) + 1 n FROM diary_entries WHERE date_key = ?', String(d.date_key))!.n
      const der = derive(content)
      const created = iso(d.created_at, now)
      run(
        `INSERT INTO diary_entries(identity, version, date_key, entry_index, title, content_md, weather, mood, tags,
          char_count, excerpt, cover_url, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        identity || randomUUID(),
        String(d.date_key),
        idx,
        String(d.title ?? '').slice(0, 300),
        content,
        String(d.weather ?? '').slice(0, 30),
        String(d.mood ?? '').slice(0, 30),
        JSON.stringify(asList(d.tags).map(String).map((t) => t.trim()).filter((t) => t && t !== '—')),
        der.char_count,
        der.excerpt,
        der.cover_url,
        created,
        iso(d.updated_at, created),
      )
    }

    // 3. 品味库
    const existingTaste = new Set(all<Row>('SELECT legacy_id, title, url, note FROM taste_items').flatMap((t) => [t.legacy_id, digest(t.title, t.url, t.note)].filter(Boolean)))
    for (const t of b.tables.taste_items || []) {
      const dg = digest(t.title, t.url, t.note)
      const legacy = t.legacy_id ? String(t.legacy_id) : null
      if ((legacy && existingTaste.has(legacy)) || existingTaste.has(dg)) {
        r.taste.skipped++
        continue
      }
      existingTaste.add(dg)
      r.taste.added++
      if (dry) continue
      const images = asList(t.images)
        .filter((x): x is Row => !!x && typeof x === 'object')
        .map((x) => ({ url: materialize(fixUrl(String(x.url ?? x.dataUrl ?? '')), 'taste', dry, inline), name: String(x.name ?? ''), width: Number(x.width) || 0, height: Number(x.height) || 0 }))
        .filter((x) => x.url)
      const created = iso(t.legacy_created_at ?? t.created_at, now)
      run(
        `INSERT INTO taste_items(legacy_id, type, title, subtitle, url, images, tags, category, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        legacy && !get('SELECT 1 FROM taste_items WHERE legacy_id = ?', legacy) ? legacy : null,
        t.type === 'note' ? 'note' : 'link',
        String(t.title ?? ''),
        String(t.subtitle ?? ''),
        String(t.url ?? ''),
        JSON.stringify(images),
        JSON.stringify(asList(t.tags).map(String)),
        String(t.category ?? ''),
        String(t.note ?? ''),
        created,
        iso(t.updated_at, created),
      )
    }

    // 4. 自习室：待办（标题+创建时间）、日程（日期+标题+开始）、会话（session_id）
    const todoMap = new Map<unknown, number>()
    for (const t of b.tables.study_todos || []) {
      const created = iso(t.created_at, now)
      const hit = get<{ id: number }>('SELECT id FROM study_todos WHERE title = ? AND created_at = ?', String(t.title ?? ''), created)
      if (hit) {
        todoMap.set(t.id, hit.id)
        r.study.skipped++
        continue
      }
      r.study.added++
      if (dry) continue
      const id = run(
        `INSERT INTO study_todos(title, duration_minutes, break_minutes, completed_pomodoros, is_completed, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        String(t.title ?? ''),
        Number(t.duration_minutes) || 25,
        Number(t.break_minutes) || 5,
        Number(t.completed_pomodoros) || 0,
        t.is_completed ? 1 : 0,
        Number(t.sort_order) || 0,
        created,
        iso(t.updated_at, created),
      ).lastInsertRowid
      todoMap.set(t.id, Number(id))
    }
    for (const s of b.tables.study_schedule || []) {
      if (!isDateKey(s.date_key)) continue
      if (get('SELECT 1 FROM study_schedule WHERE date_key = ? AND title = ? AND start_time = ?', String(s.date_key), String(s.title ?? ''), String(s.start_time ?? ''))) {
        r.study.skipped++
        continue
      }
      r.study.added++
      if (dry) continue
      run(
        'INSERT INTO study_schedule(title, date_key, start_time, end_time, is_completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        String(s.title ?? ''),
        String(s.date_key),
        String(s.start_time ?? ''),
        String(s.end_time ?? ''),
        s.is_completed ? 1 : 0,
        iso(s.created_at, now),
        iso(s.updated_at, now),
      )
    }
    for (const s of b.tables.study_sessions || []) {
      if (!s.session_id || !isDateKey(s.date_key)) continue
      if (get('SELECT 1 FROM study_sessions WHERE session_id = ?', String(s.session_id))) {
        r.study.skipped++
        continue
      }
      r.study.added++
      if (dry) continue
      run(
        `INSERT INTO study_sessions(session_id, todo_id, date_key, started_at, ended_at, planned_minutes, focused_seconds, pomodoros, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        String(s.session_id),
        todoMap.get(s.todo_id) ?? null,
        String(s.date_key),
        iso(s.started_at, now),
        s.ended_at ? iso(s.ended_at) : null,
        Number(s.planned_minutes) || 25,
        Number(s.focused_seconds) || 0,
        Number(s.pomodoros) || 0,
        s.status === 'running' ? 'abandoned' : String(s.status || 'finished'),
        iso(s.created_at, now),
      )
    }

    // 5. 个人资料：只在本机还没填时导入
    const p = (b.tables.profile || [])[0]
    const mine = get<{ name: string }>('SELECT name FROM profile WHERE id = 1')
    if (p && !mine?.name) {
      r.profile = true
      if (!dry) {
        run(
          `INSERT INTO profile(id, name, motto, avatar_url, updated_at) VALUES (1, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, motto = excluded.motto, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`,
          String(p.name ?? ''),
          String(p.motto ?? p.bio_md ?? '').slice(0, 200),
          fixUrl(String(p.avatar_url ?? '')),
          now,
        )
      }
    }
  }

  if (dry) work()
  else tx(work)
  r.images.inline = inline.n
  return r
}
