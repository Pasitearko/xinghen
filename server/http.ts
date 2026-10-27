// 极简 HTTP 层：路由、JSON、原始请求体、带 Range 的文件响应。
// 不引第三方框架——本机单用户，几十个接口，自己写反而最快最透明。
import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message)
}

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: Record<string, string>
  query: URLSearchParams
  body(limit?: number): Promise<Buffer>
  json<T = Record<string, unknown>>(): Promise<T>
}

/** 处理函数返回普通值则序列化为 JSON；返回 undefined 则 204；已自行写响应的返回 SENT。 */
export const SENT = Symbol('sent')
type Handler = (ctx: Ctx) => unknown

interface Route {
  method: string
  re: RegExp
  keys: string[]
  handler: Handler
}

const routes: Route[] = []

function add(method: string, path: string, handler: Handler) {
  const keys: string[] = []
  const pattern = path.replace(/:(\w+)(\*)?/g, (_, key: string, star?: string) => {
    keys.push(key)
    return star ? '(.+)' : '([^/]+)'
  })
  routes.push({ method, re: new RegExp(`^${pattern}/?$`), keys, handler })
}

export const route = {
  get: (p: string, h: Handler) => add('GET', p, h),
  post: (p: string, h: Handler) => add('POST', p, h),
  put: (p: string, h: Handler) => add('PUT', p, h),
  patch: (p: string, h: Handler) => add('PATCH', p, h),
  delete: (p: string, h: Handler) => add('DELETE', p, h),
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, `请求体超过 ${Math.round(limit / 1024 / 1024)}MB 上限`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function hostOk(value: string | undefined) {
  if (!value) return false
  try {
    return LOCAL_HOSTS.has(new URL(`http://${value}`).hostname)
  } catch {
    return false
  }
}

/** 只接受本机访问；写操作再拒绝跨站来源，防止外部网页借浏览器改数据。 */
function guard(req: IncomingMessage) {
  if (!hostOk(req.headers.host)) fail(403, '只允许本机访问')
  if (req.method === 'GET' || req.method === 'HEAD') return
  const origin = req.headers.origin
  if (origin && !hostOk(origin.replace(/^https?:\/\//, ''))) fail(403, '拒绝来自外部网页的写入')
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '拒绝来自外部网页的写入')
}

export async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://localhost')
  const method = req.method === 'HEAD' ? 'GET' : req.method || 'GET'
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    sendJson(res, 400, { detail: '地址编码有误' })
    return true
  }
  for (const r of routes) {
    if (r.method !== method) continue
    const m = r.re.exec(path)
    if (!m) continue
    const params: Record<string, string> = {}
    r.keys.forEach((k, i) => (params[k] = m[i + 1]))
    let bodyCache: Promise<Buffer> | null = null
    const ctx: Ctx = {
      req,
      res,
      url,
      params,
      query: url.searchParams,
      body: (limit = 2 * 1024 * 1024) => (bodyCache ??= readBody(req, limit)),
      async json<T>() {
        const buf = await ctx.body()
        if (!buf.length) return {} as T
        try {
          return JSON.parse(buf.toString('utf8')) as T
        } catch {
          return fail(400, '请求体不是合法 JSON')
        }
      },
    }
    try {
      guard(req)
      const out = await r.handler(ctx)
      if (out === SENT || res.headersSent) return true
      if (out === undefined) {
        res.writeHead(204).end()
      } else {
        sendJson(res, 200, out)
      }
    } catch (err) {
      if (res.headersSent) {
        res.destroy()
        return true
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { detail: err.message })
      } else {
        console.error(`[xinghen] ${method} ${path}`, err)
        sendJson(res, 500, { detail: '服务内部错误，详情见日志' })
      }
    }
    return true
  }
  return false
}

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.zip': 'application/zip',
}

/** 发送磁盘文件，支持 Range（音频拖动进度要用）。 */
export function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  opts: { cache?: string; type?: string; download?: string } = {},
) {
  let size: number
  let mtime: Date
  try {
    const st = statSync(file)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
    mtime = st.mtime
  } catch {
    sendJson(res, 404, { detail: '文件不存在' })
    return SENT
  }
  const headers: Record<string, string | number> = {
    'Content-Type': opts.type || MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Last-Modified': mtime.toUTCString(),
    'Cache-Control': opts.cache || 'no-cache',
  }
  if (opts.download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`
  if (req.headers['if-modified-since'] && !req.headers.range) {
    const since = Date.parse(req.headers['if-modified-since'])
    if (!Number.isNaN(since) && Math.floor(mtime.getTime() / 1000) <= Math.floor(since / 1000)) {
      res.writeHead(304, headers).end()
      return SENT
    }
  }
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    if (Number.isNaN(start) || start < 0) start = 0
    end = Math.min(end, size - 1)
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return SENT
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file, { start, end }).pipe(res)
    return SENT
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
  return SENT
}

// ---- 入参校验的小工具 ----
export function str(v: unknown, max = 1000, fallback = ''): string {
  if (v === undefined || v === null) return fallback
  return String(v).slice(0, max)
}
export function int(v: unknown, fallback: number, min = -Infinity, max = Infinity) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
export function tagList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、\s]+/) : []
  const out: string[] = []
  for (const t of raw) {
    const s = String(t).trim().slice(0, 30)
    if (s && !out.includes(s)) out.push(s)
  }
  return out.slice(0, 20)
}
