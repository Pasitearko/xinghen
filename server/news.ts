// 每日焦点：只追 Anthropic、OpenAI、DeepSeek 三家。官方来源直接收，媒体/社区/聚合按标题筛。
// 只「读」这些公开页面，不发送任何私人数据。单个来源失败不影响其他来源，并如实记录失败原因。
import { createHash } from 'node:crypto'
import { all, get, kvGet, kvSet, run, tx } from './db.ts'
import { dayKey, nowIso, todayKey } from './time.ts'

export type Category = 'official' | 'media' | 'community' | 'aggregate'
type Kind = 'rss' | 'github' | 'anthropic' | 'deepseek' | 'hn' | 'gnews'

export interface Source {
  key: string
  brand: string
  name: string
  url: string
  kind: Kind
  category: Category
  /** 官方来源直接归到这一家；其他来源按标题判断 */
  company?: Company
  /** 默认关闭，可在设置里打开 */
  off?: boolean
  home: string
}

export const SOURCES: Source[] = [
  // 官方：本身就属于某一家，不用再按标题判断
  { key: 'openai', brand: 'OpenAI', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', kind: 'rss', category: 'official', company: 'openai', home: 'https://openai.com/news' },
  { key: 'anthropic', brand: 'Anthropic', name: 'Anthropic News', url: 'https://www.anthropic.com/news', kind: 'anthropic', category: 'official', company: 'anthropic', home: 'https://www.anthropic.com/news' },
  { key: 'claude-code', brand: 'Anthropic', name: 'Claude Code 版本', url: 'https://api.github.com/repos/anthropics/claude-code/releases?per_page=10', kind: 'github', category: 'official', company: 'anthropic', home: 'https://github.com/anthropics/claude-code/releases' },
  { key: 'deepseek', brand: 'DeepSeek', name: 'DeepSeek 更新日志', url: 'https://api-docs.deepseek.com/updates/', kind: 'deepseek', category: 'official', company: 'deepseek', home: 'https://api-docs.deepseek.com/updates/' },
  // 媒体与社区：只留下标题里提到这三家的
  { key: 'qbitai', brand: '量子位', name: '量子位', url: 'https://www.qbitai.com/feed', kind: 'rss', category: 'media', home: 'https://www.qbitai.com' },
  { key: 'leiphone', brand: '雷峰网', name: '雷峰网', url: 'https://www.leiphone.com/feed', kind: 'rss', category: 'media', home: 'https://www.leiphone.com' },
  { key: 'ifanr', brand: '爱范儿', name: '爱范儿', url: 'https://www.ifanr.com/feed', kind: 'rss', category: 'media', home: 'https://www.ifanr.com' },
  { key: 'ithome', brand: 'IT之家', name: 'IT之家', url: 'https://www.ithome.com/rss/', kind: 'rss', category: 'media', home: 'https://www.ithome.com' },
  { key: 'cnbeta', brand: 'cnBeta', name: 'cnBeta', url: 'https://www.cnbeta.com.tw/backend.php', kind: 'rss', category: 'media', home: 'https://www.cnbeta.com.tw' },
  { key: 'infoq', brand: 'InfoQ', name: 'InfoQ 中文', url: 'https://www.infoq.cn/feed', kind: 'rss', category: 'media', home: 'https://www.infoq.cn' },
  { key: 'verge', brand: 'The Verge', name: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', kind: 'rss', category: 'media', home: 'https://www.theverge.com/ai-artificial-intelligence' },
  { key: 'techcrunch', brand: 'TechCrunch', name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', kind: 'rss', category: 'media', home: 'https://techcrunch.com/category/artificial-intelligence/' },
  { key: 'decoder', brand: 'The Decoder', name: 'The Decoder', url: 'https://the-decoder.com/feed/', kind: 'rss', category: 'media', home: 'https://the-decoder.com' },
  { key: 'hn', brand: 'Hacker News', name: 'Hacker News', url: 'https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E80&hitsPerPage=200', kind: 'hn', category: 'community', home: 'https://news.ycombinator.com' },
  { key: 'simonw', brand: 'Simon Willison', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', kind: 'rss', category: 'community', home: 'https://simonwillison.net' },
  // 聚合：Google 新闻按公司名搜索最近一天的报道，补上小众媒体的覆盖
  { key: 'gnews-anthropic', brand: 'Google 新闻', name: 'Google 新闻 · Claude', url: gnews('Anthropic OR Claude'), kind: 'gnews', category: 'aggregate', home: 'https://news.google.com' },
  { key: 'gnews-openai', brand: 'Google 新闻', name: 'Google 新闻 · OpenAI', url: gnews('OpenAI OR ChatGPT'), kind: 'gnews', category: 'aggregate', home: 'https://news.google.com' },
  { key: 'gnews-deepseek', brand: 'Google 新闻', name: 'Google 新闻 · DeepSeek', url: gnews('DeepSeek'), kind: 'gnews', category: 'aggregate', home: 'https://news.google.com' },
]

function gnews(q: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:1d`)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
}

/** 只关心三家：Anthropic、OpenAI、DeepSeek，以及它们旗下的模型与产品。按标题判断，标题里最先出现的那家算数。 */
export const COMPANIES = ['anthropic', 'openai', 'deepseek'] as const
export type Company = (typeof COMPANIES)[number]
const COMPANY_WORDS: Record<Company, RegExp> = {
  anthropic: /anthropic|claude|达里奥|阿莫代/i,
  openai: /openai|chatgpt|\bgpt[-‑\s]?(?:\d|o\b|image|realtime|oss)|\bsora\b|\bcodex\b|\bo[134](?:-(?:mini|pro))?\b|\bdall[-·]?e\b|altman|奥特曼|\bwhisper\b/i,
  deepseek: /deepseek|深度求索|幻方量化|梁文锋/i,
}

export function classify(title: string): Company | null {
  let best: Company | null = null
  let at = Infinity
  for (const c of COMPANIES) {
    const m = COMPANY_WORDS[c].exec(title)
    if (m && m.index < at) {
      at = m.index
      best = c
    }
  }
  return best
}

interface Raw {
  title: string
  url: string
  summary: string
  published: string | null
}

// ---------- 解析 ----------
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' }

export function decode(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
}

export function stripHtml(text: string) {
  return decode(decode(text).replace(/<[^>]+>/g, ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(block: string, names: string[]) {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(block)
    if (m) return m[1]
  }
  return ''
}

function parseDate(v: string): string | null {
  const s = decode(v).trim()
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function parseFeed(xml: string): Raw[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
  return blocks.map((b) => {
    let url = stripHtml(tag(b, ['link']))
    if (!url) {
      const alt = /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b) || /<link\b[^>]*href=["']([^"']+)["']/i.exec(b)
      url = alt ? decode(alt[1]) : ''
    }
    return {
      title: stripHtml(tag(b, ['title'])).slice(0, 300),
      url: url.trim(),
      summary: stripHtml(tag(b, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 400),
      published: parseDate(tag(b, ['pubDate', 'published', 'updated', 'dc:date'])),
    }
  })
}

/** Google 新闻：标题形如「xxx - 新浪财经」，把来源拆出来放进摘要位，链接是 Google 的跳转页。 */
export function parseGnews(xml: string): Raw[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []
  return parseFeed(xml).map((r, i) => {
    const source = stripHtml(tag(blocks[i] || '', ['source']))
    const title = source && r.title.endsWith(` - ${source}`) ? r.title.slice(0, -source.length - 3) : r.title
    return { ...r, title, summary: source ? `来自${source}` : '' }
  })
}

function parseGithub(json: string, brand: string): Raw[] {
  const rows = JSON.parse(json)
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r && (r.tag_name || r.name) && !r.draft)
    .map((r) => ({
      title: `${brand} ${r.tag_name || r.name}`,
      url: String(r.html_url || ''),
      summary: String(r.body || '')
        .replace(/^#+\s.*$/gm, '')
        .replace(/[*`_>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400),
      published: parseDate(String(r.published_at || r.created_at || '')),
    }))
}

function parseHn(json: string): Raw[] {
  const hits = JSON.parse(json).hits
  if (!Array.isArray(hits)) return []
  return hits.map((h: Record<string, unknown>) => ({
    title: String(h.title || ''),
    url: String(h.url || `https://news.ycombinator.com/item?id=${h.objectID}`),
    summary: `${h.points} 分 · ${h.num_comments ?? 0} 条讨论`,
    published: parseDate(String(h.created_at || '')),
  }))
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

export function parseAnthropic(html: string): Raw[] {
  const DATE = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})/i
  const anchors = [...html.matchAll(/<a\b[^>]*href="\/news\/([a-z0-9-]{2,90})"[^>]*>([\s\S]{0,4000}?)<\/a>/gi)].map((m) => ({
    slug: m[1],
    inner: m[2],
    text: stripHtml(m[2]),
    start: m.index!,
    end: m.index! + m[0].length,
  }))
  // 栏目入口（Announcements / Product…）的文字就是 slug 本身
  const isCategory = (a: { slug: string; text: string }) => a.text.split(/\s+/).length <= 2 && a.text.toLowerCase().replace(/\s+/g, '-') === a.slug
  const articles = anchors.filter((a) => a.text && !isCategory(a))
  const out: Raw[] = []
  const seen = new Set<string>()
  articles.forEach((a, i) => {
    if (seen.has(a.slug) || a.text.length > 400) return
    seen.add(a.slug)
    // 日期可能在卡片里，也可能在卡片后面（列表视图）：看到下一篇不同文章为止
    const nextOther = articles.slice(i + 1).find((b) => b.slug !== a.slug)
    const windowText = stripHtml(html.slice(a.start, nextOther ? nextOther.start : a.end + 3000))
    // 置顶大卡片：先是「栏目 + 日期」，再是一张图片链接，日期在图片之前
    const image = anchors.find((b) => b.slug === a.slug && !b.text && b.start < a.start)
    const dm = (image && DATE.exec(stripHtml(html.slice(Math.max(0, image.start - 800), image.start)))) || DATE.exec(windowText)
    if (!dm) return
    // 同一篇文章常有「标题链接 + 简介链接」两个锚点：有 <h*> 的是标题，否则取最短的那段
    const group = articles.filter((b) => b.slug === a.slug)
    const withHeading = group.map((b) => /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(b.inner)).find(Boolean)
    const title = (withHeading ? stripHtml(withHeading[1]) : [...group].sort((x, y) => x.text.length - y.text.length)[0].text).replace(dm[0], '').trim()
    const desc = group.map((b) => b.text).find((t) => t !== title && !t.startsWith(title)) || ''
    out.push({
      title: title.slice(0, 300),
      url: `https://www.anthropic.com/news/${a.slug}`,
      summary: desc.slice(0, 300),
      published: new Date(Date.UTC(Number(dm[3]), MONTHS[dm[1].slice(0, 3).toLowerCase()], Number(dm[2]), 12)).toISOString(),
    })
  })
  return out
}

function parseDeepseek(html: string): Raw[] {
  const plain = stripHtml(html)
  const marks = [...plain.matchAll(/Date:\s*(\d{4}-\d{2}-\d{2})\s+((?:(?!Date:\s*\d{4}-\d{2}-\d{2}).){0,300})/g)]
  return marks.flatMap((m, i) => {
    const title = m[2].split(/(?<=[.。!！?？])\s|Today,|The official/)[0].trim().slice(0, 140)
    if (!title) return []
    const end = i + 1 < marks.length ? marks[i + 1].index! : m.index! + 1200
    return [{
      title,
      url: 'https://api-docs.deepseek.com/updates/',
      summary: plain.slice(m.index! + m[0].length - m[2].length + title.length, end).trim().slice(0, 400),
      published: new Date(`${m[1]}T12:00:00Z`).toISOString(),
    }]
  })
}

// ---------- 抓取与入库 ----------
const UA = 'Mozilla/5.0 (X11; Linux x86_64) FeixingNews/2.0 (+local personal use)'

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/html, application/json;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function canon(url: string) {
  return url.split('#')[0].replace(/[?&](utm_[^=&]+|ref|source|fbclid)=[^&]*/g, '').replace(/[?&]$/, '').replace(/\/$/, '')
}

function dedupKey(src: Source, r: Raw) {
  const basis = r.url && src.kind !== 'deepseek' ? canon(r.url) : `${src.key}|${r.title}`
  return createHash('sha1').update(basis).digest('hex').slice(0, 32)
}

function sourceState(key: string) {
  return get<{ enabled: number; status: string; last_success_at: string | null; last_attempt_at: string | null; last_error: string; last_count: number }>(
    'SELECT * FROM news_sources WHERE key = ?',
    key,
  )
}

export function ensureSources() {
  for (const s of SOURCES) {
    run('INSERT INTO news_sources(key, enabled) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', s.key, s.off ? 0 : 1)
  }
}

async function refreshSource(src: Source) {
  const attempt = nowIso()
  try {
    const text = await fetchText(src.url)
    let items =
      src.kind === 'rss'
        ? parseFeed(text)
        : src.kind === 'gnews'
          ? parseGnews(text)
          : src.kind === 'github'
            ? parseGithub(text, 'Claude Code')
            : src.kind === 'anthropic'
              ? parseAnthropic(text)
              : src.kind === 'hn'
                ? parseHn(text)
                : parseDeepseek(text)
    // 官方来源整条收下；其他来源只留标题里提到三家之一的
    items = items.filter((r) => r.title && (src.company || classify(r.title)))
    if (!items.length && src.kind !== 'rss') throw new Error('页面结构可能变了：没解析出任何条目')
    const fetched = nowIso()
    // 第一次抓某个来源时，没有发布时间的旧条目不能算作「今天的新闻」
    const firstRun = !sourceState(src.key)?.last_success_at
    const limit = Date.now() + 2 * 3600_000
    for (const r of items) if (r.published && Date.parse(r.published) > limit) r.published = fetched
    // 只收最新的：发布超过 FRESH_HOURS 的不入库；没有发布时间的只在「后来新出现」时才算新
    const fresh = Date.now() - FRESH_HOURS * 3600_000
    const recent = items.filter((r) => (r.published ? Date.parse(r.published) >= fresh : !firstRun))
    let added = 0
    tx(() => {
      for (const r of recent.slice(0, 40)) {
        const res = run(
          `INSERT INTO news_items(dedup_key, brand, source_key, title, summary, url, published_at, fetched_at, published_day)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedup_key) DO NOTHING`,
          dedupKey(src, r),
          src.brand,
          src.key,
          r.title,
          r.summary,
          r.url,
          r.published,
          fetched,
          // 没有发布时间的条目归到「本机首次发现」那天，不冒充官方日期
          r.published ? dayKey(r.published) : dayKey(fetched),
        )
        added += Number(res.changes)
      }
      run(
        "UPDATE news_sources SET status = 'ok', last_success_at = ?, last_attempt_at = ?, last_error = '', last_count = ? WHERE key = ?",
        fetched,
        attempt,
        recent.length,
        src.key,
      )
    })
    return { key: src.key, ok: true, count: recent.length, added }
  } catch (err) {
    const message = err instanceof Error ? (err.name === 'TimeoutError' ? '请求超时' : err.message) : String(err)
    run("UPDATE news_sources SET status = 'failed', last_attempt_at = ?, last_error = ? WHERE key = ?", attempt, message.slice(0, 300), src.key)
    return { key: src.key, ok: false, error: message }
  }
}

/** 资讯只看新鲜的：入库只收 24 小时内发布的，超过 36 小时的直接删掉，不留存旧闻。 */
export const FRESH_HOURS = 24
const KEEP_HOURS = 36

export function pruneNews() {
  const cutoff = new Date(Date.now() - KEEP_HOURS * 3600_000).toISOString()
  run('DELETE FROM news_items WHERE COALESCE(published_at, fetched_at) < ?', cutoff)
  // 已经下线的来源，留下的条目也一并清掉
  const keys = SOURCES.map((s) => s.key)
  run(`DELETE FROM news_items WHERE source_key NOT IN (${keys.map(() => '?').join(', ')})`, ...keys)
}

let running: Promise<unknown> | null = null

export function refreshAll() {
  if (running) return running
  ensureSources()
  const enabled = SOURCES.filter((s) => sourceState(s.key)?.enabled)
  running = (async () => {
    const results: Awaited<ReturnType<typeof refreshSource>>[] = []
    const queue = [...enabled]
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        while (queue.length) results.push(await refreshSource(queue.shift()!))
      }),
    )
    kvSet('news.refreshed_at', nowIso())
    pruneNews()
    return results
  })().finally(() => {
    running = null
  })
  return running
}

export const isRefreshing = () => running !== null

/** 本机只在开机时运行：启动时若超过 3 小时没更新就补抓一次，之后每 3 小时一次。 */
export function startScheduler() {
  ensureSources()
  pruneNews()
  const due = () => {
    const last = kvGet<string | null>('news.refreshed_at', null)
    return !last || Date.now() - Date.parse(last) > 3 * 3600_000
  }
  setTimeout(() => due() && refreshAll(), 4000).unref()
  setInterval(() => {
    pruneNews()
    if (due()) refreshAll()
  }, 10 * 60_000).unref()
}

export function sourceList() {
  ensureSources()
  return SOURCES.map((s) => {
    const st = sourceState(s.key)!
    return {
      key: s.key,
      brand: s.brand,
      name: s.name,
      category: s.category,
      home: s.home,
      enabled: !!st.enabled,
      status: st.status,
      last_success_at: st.last_success_at,
      last_attempt_at: st.last_attempt_at,
      last_error: st.last_error,
      last_count: st.last_count,
    }
  })
}

interface ItemRow {
  id: number
  brand: string
  source_key: string
  title: string
  summary: string
  url: string
  published_at: string | null
  fetched_at: string
  published_day: string
}

const META = new Map(SOURCES.map((s) => [s.key, s]))

function serialize(r: ItemRow, company: Company) {
  const s = META.get(r.source_key)
  return { ...r, company, category: s?.category || 'media', source_name: s?.name || r.source_key, dated: !!r.published_at }
}

/** 同一件事常被几家同时报道：去掉标点空白后标题前 18 个字相同就算重复，留最早抓到的那条（官方优先） */
const sameStory = (t: string) => t.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 18)

const PER_COMPANY = 12
const PER_SOURCE = 8

export function feed() {
  const today = todayKey()
  const since = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString()
  const enabled = new Set(sourceList().filter((s) => s.enabled).map((s) => s.key))
  const rows = all<ItemRow>(
    'SELECT * FROM news_items WHERE COALESCE(published_at, fetched_at) >= ? ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC LIMIT 600',
    since,
  ).filter((r) => enabled.has(r.source_key))
  // 官方的排在前面参与去重，这样同一条消息留下的是官方原文
  rows.sort((x, y) => Number(META.get(y.source_key)?.category === 'official') - Number(META.get(x.source_key)?.category === 'official'))
  const seen = new Set<string>()
  const per = new Map<string, number>()
  const groups: Record<Company, ReturnType<typeof serialize>[]> = { anthropic: [], openai: [], deepseek: [] }
  for (const r of rows) {
    const company = META.get(r.source_key)?.company || classify(r.title)
    if (!company) continue
    const story = sameStory(r.title)
    if (seen.has(story)) continue
    const k = `${company}:${r.source_key}`
    const n = (per.get(k) || 0) + 1
    if (n > PER_SOURCE || groups[company].length >= PER_COMPANY) continue
    per.set(k, n)
    seen.add(story)
    groups[company].push(serialize(r, company))
  }
  const time = (x: ItemRow) => x.published_at || x.fetched_at
  for (const c of COMPANIES) groups[c].sort((x, y) => time(y).localeCompare(time(x)))
  return {
    today,
    companies: COMPANIES.map((c) => ({ key: c, items: groups[c] })),
    refreshed_at: kvGet<string | null>('news.refreshed_at', null),
    refreshing: isRefreshing(),
    failed: sourceList().filter((s) => s.enabled && s.status === 'failed').map((s) => ({ key: s.key, name: s.name, error: s.last_error })),
  }
}
