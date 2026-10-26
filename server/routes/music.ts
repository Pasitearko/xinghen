// 本地音乐：扫描音乐目录（默认 ~/.local/share/feixing/music，可用 FEIXING_MUSIC_DIR 指到 ~/Music），
// 读取 ID3 / FLAC 标签里的曲名、歌手和封面；同名 .lrc 作为歌词。只按扫描得到的 ID 取文件，不接受路径参数。
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { fail, MIME, route, SENT, sendFile } from '../http.ts'
import { MUSIC_DIR } from '../paths.ts'

const AUDIO = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.webm'])
const COVER_NAMES = ['cover', 'folder', 'front', 'album']

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

function readHead(path: string, bytes: number) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const n = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n)
  } finally {
    closeSync(fd)
  }
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

/** 读 ID3v2.3/2.4 的曲名、歌手、专辑、封面位置（封面只记偏移，用时再读）。 */
function readId3(path: string) {
  const head = readHead(path, 10)
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null
  const ver = head[3]
  if (ver < 3) return null
  const size = synchsafe(head, 6)
  const tag = readHead(path, Math.min(size + 10, 12 * 1024 * 1024))
  const out: { title?: string; artist?: string; album?: string; picture?: Picture } = {}
  let p = 10
  if (head[5] & 0x40) p += ver === 4 ? synchsafe(tag, 10) : tag.readUInt32BE(10) + 4
  while (p + 10 <= tag.length) {
    const id = tag.toString('latin1', p, p + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const len = ver === 4 ? synchsafe(tag, p + 4) : tag.readUInt32BE(p + 4)
    const start = p + 10
    if (len <= 0 || start + len > tag.length) break
    const data = tag.subarray(start, start + len)
    if (id === 'TIT2') out.title = decodeId3Text(data)
    else if (id === 'TPE1') out.artist = decodeId3Text(data)
    else if (id === 'TALB') out.album = decodeId3Text(data)
    else if (id === 'APIC' && !out.picture) {
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
      out.picture = { mime: mime.includes('/') ? mime : `image/${mime.toLowerCase()}`, offset: start + q, length: len - q }
    }
    p = start + len
  }
  return out
}

/** FLAC：VORBIS_COMMENT 与 PICTURE 块。 */
function readFlac(path: string) {
  const buf = readHead(path, 8 * 1024 * 1024)
  if (buf.toString('latin1', 0, 4) !== 'fLaC') return null
  const out: { title?: string; artist?: string; album?: string; picture?: Picture } = {}
  let p = 4
  while (p + 4 <= buf.length) {
    const last = buf[p] & 0x80
    const type = buf[p] & 0x7f
    const len = buf.readUIntBE(p + 1, 3)
    const start = p + 4
    if (start + len > buf.length) break
    if (type === 4) {
      let q = start
      const vlen = buf.readUInt32LE(q)
      q += 4 + vlen
      const n = buf.readUInt32LE(q)
      q += 4
      for (let i = 0; i < n && q < start + len; i++) {
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
      let q = start + 4
      const ml = buf.readUInt32BE(q)
      const mime = buf.toString('latin1', q + 4, q + 4 + ml)
      q += 4 + ml
      const dl = buf.readUInt32BE(q)
      q += 4 + dl + 16
      const plen = buf.readUInt32BE(q)
      out.picture = { mime: mime || 'image/jpeg', offset: q + 4, length: plen }
    }
    p = start + len
    if (last) break
  }
  return out
}

let cache: { at: number; tracks: Track[] } | null = null

function walk(dir: string, depth = 0, out: string[] = []) {
  if (depth > 6) return out
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, depth + 1, out)
    else if (AUDIO.has(extname(name).toLowerCase())) out.push(full)
  }
  return out
}

function scan(force = false) {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.tracks
  const tracks = walk(MUSIC_DIR)
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map((path): Track => {
      const rel = relative(MUSIC_DIR, path)
      const ext = extname(path).toLowerCase()
      const stem = path.slice(0, -ext.length)
      let tags: ReturnType<typeof readId3> = null
      try {
        tags = ext === '.mp3' ? readId3(path) : ext === '.flac' ? readFlac(path) : null
      } catch {
        tags = null
      }
      const byName = fromFilename(basename(path))
      const dir = path.slice(0, path.length - basename(path).length)
      const coverFile =
        ['.jpg', '.png', '.webp'].map((e) => stem + e).find(existsSync) ||
        COVER_NAMES.flatMap((n) => ['.jpg', '.png', '.webp'].map((e) => join(dir, n + e))).find(existsSync) ||
        null
      return {
        id: createHash('sha1').update(rel).digest('hex').slice(0, 16),
        path,
        title: tags?.title || byName.title,
        artist: tags?.artist || byName.artist,
        album: tags?.album || '',
        lyrics: existsSync(`${stem}.lrc`) ? `${stem}.lrc` : null,
        coverFile,
        picture: tags?.picture || null,
        size: statSync(path).size,
      }
    })
  cache = { at: Date.now(), tracks }
  return tracks
}

function find(id: string) {
  return scan().find((t) => t.id === id) || scan(true).find((t) => t.id === id) || null
}

route.get('/api/music/tracks', (ctx) => {
  const tracks = scan(ctx.query.get('refresh') === '1')
  return {
    dir: MUSIC_DIR,
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      has_lyrics: !!t.lyrics,
      has_cover: !!(t.picture || t.coverFile),
      size: t.size,
    })),
  }
})

route.get('/api/music/file/:id', (ctx) => {
  const t = find(ctx.params.id)
  if (!t) fail(404, '找不到这首歌，可能已被移走')
  return sendFile(ctx.req, ctx.res, t!.path, { cache: 'private, max-age=3600', type: MIME[extname(t!.path).toLowerCase()] })
})

route.get('/api/music/lyrics/:id', (ctx) => {
  const t = find(ctx.params.id)
  if (!t?.lyrics) fail(404, '这首歌没有歌词')
  const buf = readFileSync(t!.lyrics!)
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

route.get('/api/music/cover/:id', (ctx) => {
  const t = find(ctx.params.id)
  if (!t) fail(404, '没有封面')
  if (t!.picture) {
    const fd = openSync(t!.path, 'r')
    try {
      const buf = Buffer.alloc(t!.picture.length)
      readSync(fd, buf, 0, buf.length, t!.picture.offset)
      ctx.res.writeHead(200, { 'Content-Type': t!.picture.mime, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' })
      ctx.res.end(buf)
      return SENT
    } finally {
      closeSync(fd)
    }
  }
  if (t!.coverFile) return sendFile(ctx.req, ctx.res, t!.coverFile, { cache: 'private, max-age=86400' })
  return fail(404, '没有封面')
})
