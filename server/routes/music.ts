// 本地音乐：扫描音乐目录（默认 ~/.local/share/feixing/music，可用 FEIXING_MUSIC_DIR 指到 ~/Music），
// 读取 ID3 / FLAC 标签里的曲名、歌手和封面；同名 .lrc 作为歌词。只按扫描得到的 ID 取文件，不接受路径参数。
// 扫描结果存成索引（数据目录下的 music-index.json），取歌、封面、歌词都直接查索引，不再临时扫目录。
import { createHash } from 'node:crypto'
import { type Dirent, readFileSync } from 'node:fs'
import { type FileHandle, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { fail, MIME, route, SENT, sendFile } from '../http.ts'
import { DATA_DIR, MUSIC_DIR } from '../paths.ts'

const AUDIO = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.webm'])
const COVER_NAMES = ['cover', 'folder', 'front', 'album']
const SHARED_COVERS = ['.jpg', '.jpeg', '.png', '.webp'].map((e) => join(MUSIC_DIR, `封面${e}`))

/** 音乐根目录里的「封面.jpg」（png、webp 也行）覆盖所有歌曲的封面，不依赖曲库索引。 */
async function sharedCoverFile() {
  for (const f of SHARED_COVERS) {
    const st = await stat(f).catch(() => null)
    if (st?.isFile()) return f
  }
  return null
}

interface Picture {
  mime: string
  offset: number
  length: number
}

interface Track {
  id: string
  path: string
  title: string
  artist: string
  album: string
  lyrics: string | null
  coverFile: string | null
  picture: Picture | null
  size: number
  mtime: number
}

/** 「歌手 - 曲名」或「曲名-歌手」 */
function fromFilename(name: string) {
  const stem = name.replace(/\.[^.]+$/, '').trim()
  const spaced = stem.split(/\s+-\s+/)
  if (spaced.length >= 2) return { artist: spaced[0].trim(), title: spaced.slice(1).join(' - ').trim() }
  const i = stem.lastIndexOf('-')
  if (i > 0 && i < stem.length - 1) return { title: stem.slice(0, i).trim(), artist: stem.slice(i + 1).trim() }
  return { title: stem, artist: '' }
}

/** 从文件的某个位置读一小段（读到文件尾就返回实际读到的部分） */
async function readAt(fh: FileHandle, pos: number, len: number) {
  const buf = Buffer.alloc(Math.max(0, len))
  const { bytesRead } = await fh.read(buf, 0, buf.length, pos)
  return buf.subarray(0, bytesRead)
}

function decodeId3Text(buf: Buffer) {
  const enc = buf[0]
  const body = buf.subarray(1)
  let s: string
  if (enc === 1 || enc === 2) s = new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16').decode(body)
  else if (enc === 3) s = body.toString('utf8')
  else s = new TextDecoder('latin1').decode(body)
  return s.replace(/\0+$/g, '').split('\0')[0].trim()
}

function synchsafe(b: Buffer, o: number) {
  return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3]
}

type Tags = { title?: string; artist?: string; album?: string; picture?: Picture }
const TEXT_FRAMES: Record<string, 'title' | 'artist' | 'album'> = { TIT2: 'title', TPE1: 'artist', TALB: 'album' }

/**
 * 读 ID3v2.3/2.4 的曲名、歌手、专辑、封面位置。
 * 只读每个帧的 10 字节帧头，需要的帧才读内容；封面只读开头几百字节算出图片的偏移，用时再读。
 */
async function readId3(fh: FileHandle): Promise<Tags | null> {
  const head = await readAt(fh, 0, 10)
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null
  const ver = head[3]
  if (ver < 3) return null
  const end = 10 + synchsafe(head, 6)
  const out: Tags = {}
  let p = 10
  if (head[5] & 0x40) {
    const ext = await readAt(fh, 10, 4)
    p += ver === 4 ? synchsafe(ext, 0) : ext.readUInt32BE(0) + 4
  }
  for (let frames = 0; p + 10 <= end && frames < 256; frames++) {
    const fh10 = await readAt(fh, p, 10)
    if (fh10.length < 10) break
    const id = fh10.toString('latin1', 0, 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const len = ver === 4 ? synchsafe(fh10, 4) : fh10.readUInt32BE(4)
    const start = p + 10
    if (len <= 0 || start + len > end) break
    if (TEXT_FRAMES[id]) out[TEXT_FRAMES[id]] = decodeId3Text(await readAt(fh, start, Math.min(len, 4096)))
    else if (id === 'APIC' && !out.picture) {
      const data = await readAt(fh, start, Math.min(len, 1024))
      const enc = data[0]
      let q = 1
      const mimeEnd = data.indexOf(0, q)
      const mime = data.toString('latin1', q, mimeEnd) || 'image/jpeg'
      q = mimeEnd + 2 // 跳过 picture type
      if (enc === 1 || enc === 2) {
        while (q + 1 < data.length && !(data[q] === 0 && data[q + 1] === 0)) q += 2
        q += 2
      } else {
        q = data.indexOf(0, q) + 1
      }
      if (mimeEnd > 0 && q > 0) out.picture = { mime: mime.includes('/') ? mime : `image/${mime.toLowerCase()}`, offset: start + q, length: len - q }
    }
    if (out.title && out.artist && out.album && out.picture) break
    p = start + len
  }
  return out
}

/** FLAC：逐个读元数据块头，只读 VORBIS_COMMENT 的内容和 PICTURE 的头部。 */
async function readFlac(fh: FileHandle): Promise<Tags | null> {
  if ((await readAt(fh, 0, 4)).toString('latin1') !== 'fLaC') return null
  const out: Tags = {}
  let p = 4
  let comments = false
  for (let blocks = 0; blocks < 64; blocks++) {
    const h = await readAt(fh, p, 4)
    if (h.length < 4) break
    const last = h[0] & 0x80
    const type = h[0] & 0x7f
    const len = h.readUIntBE(1, 3)
    const start = p + 4
    if (type === 4 && !comments) {
      comments = true
      const buf = await readAt(fh, start, Math.min(len, 1024 * 1024))
      let q = 0
      const vlen = buf.readUInt32LE(q)
      q += 4 + vlen
      const n = buf.readUInt32LE(q)
      q += 4
      for (let i = 0; i < n && q + 4 <= buf.length; i++) {
        const l = buf.readUInt32LE(q)
        const kv = buf.toString('utf8', q + 4, q + 4 + l)
        q += 4 + l
        const eq = kv.indexOf('=')
        const k = kv.slice(0, eq).toUpperCase()
        const v = kv.slice(eq + 1)
        if (k === 'TITLE') out.title ??= v
        if (k === 'ARTIST') out.artist ??= v
        if (k === 'ALBUM') out.album ??= v
      }
    } else if (type === 6 && !out.picture) {
      // 块头里 MIME 和描述都很短，先读 8KB；描述特别长时再按实际长度补读
      let buf = await readAt(fh, start, Math.min(len, 8192))
      const need = 8 + buf.readUInt32BE(4) + 4
      if (need + 4 <= len && need + 4 > buf.length) buf = await readAt(fh, start, Math.min(len, need + buf.readUInt32BE(need - 4) + 24))
      let q = 4
      const ml = buf.readUInt32BE(q)
      const mime = buf.toString('latin1', q + 4, q + 4 + ml)
      q += 4 + ml
      const dl = buf.readUInt32BE(q)
      q += 4 + dl + 16
      const plen = buf.readUInt32BE(q)
      out.picture = { mime: mime || 'image/jpeg', offset: start + q + 4, length: plen }
    }
    p = start + len
    if (last || (comments && out.picture)) break
  }
  return out
}

// ---------- 曲库索引 ----------
// 索引存在数据目录里，重启后直接可用；扫描在后台异步进行，同一时间只跑一次。
// 文件的修改时间和大小都没变就沿用上次读到的标签，只有新增或改过的文件才重新读。
const INDEX_FILE = join(DATA_DIR, 'music-index.json')
const INDEX_VERSION = 1

let tracks: Track[] = []
let byId = new Map<string, Track>()
let scannedAt = 0
let scanning: Promise<Track[]> | null = null

function setTracks(list: Track[]) {
  tracks = list
  byId = new Map(list.map((t) => [t.id, t]))
}

function loadIndex() {
  try {
    const saved = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as { v: number; dir: string; tracks: Track[] }
    if (saved.v === INDEX_VERSION && saved.dir === MUSIC_DIR && Array.isArray(saved.tracks)) setTracks(saved.tracks)
  } catch {
    /* 第一次运行或索引坏了：重新扫 */
  }
}
loadIndex()

async function walk(dir: string, depth = 0, out: { path: string; names: Set<string> }[] = []) {
  if (depth > 6) return out
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  // 同目录的文件名一次拿到，找歌词和封面时直接查表，不必一个个 stat
  const names = new Set(entries.map((e) => e.name))
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await walk(full, depth + 1, out)
    else if (AUDIO.has(extname(e.name).toLowerCase())) out.push({ path: full, names })
  }
  return out
}

async function describe(path: string, names: Set<string>, prev: Track | undefined): Promise<Track | null> {
  let st
  try {
    st = await stat(path)
  } catch {
    return null
  }
  const mtime = st.mtimeMs
  if (prev && prev.size === st.size && prev.mtime === mtime) return prev
  const rel = relative(MUSIC_DIR, path)
  const ext = extname(path).toLowerCase()
  const file = basename(path)
  const stemName = file.slice(0, -ext.length)
  const dir = path.slice(0, path.length - file.length)
  let tags: Tags | null = null
  if (ext === '.mp3' || ext === '.flac') {
    const fh = await open(path, 'r').catch(() => null)
    if (fh) {
      try {
        tags = ext === '.mp3' ? await readId3(fh) : await readFlac(fh)
      } catch {
        tags = null
      } finally {
        await fh.close()
      }
    }
  }
  const byName = fromFilename(file)
  const IMG = ['.jpg', '.png', '.webp']
  const cover = IMG.map((e) => stemName + e).find((n) => names.has(n)) || COVER_NAMES.flatMap((n) => IMG.map((e) => n + e)).find((n) => names.has(n))
  return {
    id: createHash('sha1').update(rel).digest('hex').slice(0, 16),
    path,
    title: tags?.title || byName.title,
    artist: tags?.artist || byName.artist,
    album: tags?.album || '',
    lyrics: names.has(`${stemName}.lrc`) ? join(dir, `${stemName}.lrc`) : null,
    coverFile: cover ? join(dir, cover) : null,
    picture: tags?.picture || null,
    size: st.size,
    mtime,
  }
}

/** 扫一遍音乐目录。已经在扫就等那一次，不会同时跑两遍 */
function scan(): Promise<Track[]> {
  scanning ??= (async () => {
    try {
      const prev = new Map(tracks.map((t) => [t.path, t]))
      const files = (await walk(MUSIC_DIR)).sort((a, b) => a.path.localeCompare(b.path, 'zh'))
      const out: (Track | null)[] = new Array(files.length)
      // 限制并发：机械硬盘上同时开太多文件反而更慢
      let next = 0
      const worker = async () => {
        while (next < files.length) {
          const i = next++
          out[i] = await describe(files[i].path, files[i].names, prev.get(files[i].path))
        }
      }
      await Promise.all(Array.from({ length: 8 }, worker))
      const list = out.filter((t): t is Track => !!t)
      setTracks(list)
      scannedAt = Date.now()
      const tmp = `${INDEX_FILE}.tmp`
      await writeFile(tmp, JSON.stringify({ v: INDEX_VERSION, dir: MUSIC_DIR, tracks: list }))
      await rename(tmp, INDEX_FILE)
      return list
    } finally {
      scanning = null
    }
  })()
  return scanning
}

/** 按 ID 找歌；找不到（可能是刚放进来的新歌）就补扫一次，10 秒内不重复补扫 */
async function find(id: string) {
  const hit = byId.get(id)
  if (hit || Date.now() - scannedAt < 10_000) return hit || null
  await scan()
  return byId.get(id) || null
}

route.get('/api/music/tracks', async (ctx) => {
  // 手动「重新扫描」或还没有索引时等扫完；平时直接用索引，后台顺便核对一遍（每次启动后第一次打开时）
  if (ctx.query.get('refresh') === '1' || !tracks.length) await scan()
  else if (!scannedAt) void scan()
  const sharedCover = await sharedCoverFile()
  return {
    dir: MUSIC_DIR,
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      has_lyrics: !!t.lyrics,
      has_cover: !!(sharedCover || t.picture || t.coverFile),
      size: t.size,
    })),
  }
})

route.get('/api/music/file/:id', async (ctx) => {
  const t = await find(ctx.params.id)
  if (!t) fail(404, '找不到这首歌，可能已被移走')
  return sendFile(ctx.req, ctx.res, t!.path, { cache: 'private, max-age=3600', type: MIME[extname(t!.path).toLowerCase()] })
})

route.get('/api/music/lyrics/:id', async (ctx) => {
  const t = await find(ctx.params.id)
  if (!t?.lyrics) fail(404, '这首歌没有歌词')
  const buf = await readFile(t!.lyrics!).catch(() => fail(404, '歌词文件不见了'))
  let text: string
  if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder('utf-16le').decode(buf)
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = new TextDecoder('utf-16be').decode(buf)
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      text = new TextDecoder('gbk').decode(buf)
    }
  }
  return { text: text.replace(/^﻿/, '') }
})

route.get('/api/music/cover/:id', async (ctx) => {
  const t = await find(ctx.params.id)
  if (!t) fail(404, '没有封面')
  const sharedCover = await sharedCoverFile()
  if (sharedCover) return sendFile(ctx.req, ctx.res, sharedCover, { cache: 'private, no-cache' })
  if (t!.picture) {
    const fh = await open(t!.path, 'r')
    try {
      const buf = await readAt(fh, t!.picture.offset, t!.picture.length)
      ctx.res.writeHead(200, { 'Content-Type': t!.picture.mime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' })
      ctx.res.end(buf)
      return SENT
    } finally {
      await fh.close()
    }
  }
  if (t!.coverFile) return sendFile(ctx.req, ctx.res, t!.coverFile, { cache: 'private, max-age=86400' })
  return fail(404, '没有封面')
})
