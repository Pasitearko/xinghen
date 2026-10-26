// 网页静态文件：/assets 下带哈希的文件长期缓存，index.html 每次都校验，
// 预压缩的 .br/.gz 优先返回；文件读进内存缓存，切页几乎零开销。
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { MIME } from './http.ts'
import { WEB_DIST } from './paths.ts'

interface Entry {
  body: Buffer
  br?: Buffer
  gz?: Buffer
  mtime: number
}
const memo = new Map<string, Entry>()

function load(file: string): Entry | null {
  let st
  try {
    st = statSync(file)
  } catch {
    return null
  }
  if (!st.isFile()) return null
  const hit = memo.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit
  const entry: Entry = { body: readFileSync(file), mtime: st.mtimeMs }
  if (existsSync(`${file}.br`)) entry.br = readFileSync(`${file}.br`)
  if (existsSync(`${file}.gz`)) entry.gz = readFileSync(`${file}.gz`)
  memo.set(file, entry)
  return entry
}

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>飞星</title>
<body style="font:16px system-ui;background:#141c33;color:#e6ecf5;display:grid;place-items:center;height:100vh;margin:0">
<div><h1 style="font-weight:300">网页还没构建</h1><p>在项目目录运行 <code>./feixing build</code> 或 <code>./feixing start</code>。</p></div>`

export function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost')
  let rel: string
  try {
    rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
  } catch {
    res.writeHead(400).end()
    return
  }
  if (rel.split(sep).includes('..')) {
    res.writeHead(403).end()
    return
  }
  let file = join(WEB_DIST, rel)
  let entry = rel ? load(file) : null
  const isAsset = rel.startsWith('assets/')
  if (!entry) {
    if (isAsset || extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
      return
    }
    // 前端路由：未知路径都回到 index.html
    file = join(WEB_DIST, 'index.html')
    entry = load(file)
    if (!entry) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' }).end(NOT_BUILT)
      return
    }
  }
  const accept = String(req.headers['accept-encoding'] || '')
  const headers: Record<string, string | number> = {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
  }
  let body = entry.body
  if (entry.br && accept.includes('br')) {
    body = entry.br
    headers['Content-Encoding'] = 'br'
  } else if (entry.gz && accept.includes('gzip')) {
    body = entry.gz
    headers['Content-Encoding'] = 'gzip'
  }
  const etag = `"${entry.mtime.toString(36)}-${entry.body.length.toString(36)}"`
  headers.ETag = etag
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end()
    return
  }
  headers['Content-Length'] = body.length
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}
