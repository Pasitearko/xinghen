import { createHash } from 'node:crypto'
import type { Raw } from './news-types.ts'

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
  }).map((r) => ({ ...r, dateOnly: !!r.published?.endsWith('T00:00:00.000Z') }))
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

export function parseGithub(json: string, brand: string): Raw[] {
  const rows = JSON.parse(json)
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r && (r.tag_name || r.name) && !r.draft)
    .map((r) => ({
      title: `${brand} ${r.tag_name || r.name}${r.prerelease ? '（预发布）' : ''}`,
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

export function parseHn(json: string): Raw[] {
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
      published: new Date(Date.UTC(Number(dm[3]), MONTHS[dm[1].slice(0, 3).toLowerCase()], Number(dm[2]))).toISOString(),
      dateOnly: true,
    })
  })
  return out
}

export function parseDeepseek(html: string): Raw[] {
  return parseDated(html, 'https://api-docs.deepseek.com/updates/', 'DeepSeek')
}

export function parseHf(json: string, brand: string): Raw[] {
  const list = JSON.parse(json) as { id: string; createdAt?: string; pipeline_tag?: string }[]
  return list.map((m) => ({
    title: `${brand} 在 Hugging Face 发布新模型 ${m.id.split('/').pop()}`,
    url: `https://huggingface.co/${m.id}`,
    summary: m.pipeline_tag ? `类型：${m.pipeline_tag}` : '',
    published: m.createdAt ? new Date(m.createdAt).toISOString() : null,
  }))
}

function dateIn(text: string, year?: string): string | null {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`
  const cn = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text)
  if (cn) return new Date(Date.UTC(+cn[1], +cn[2] - 1, +cn[3])).toISOString()
  const en = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i.exec(text)
  if (en && (en[3] || year)) return new Date(Date.UTC(+(en[3] || year!), MONTHS[en[1].slice(0, 3).toLowerCase()], +en[2])).toISOString()
  return null
}

function anchor(attrs: string, fallback: string) {
  return /\bid=["']([^"']+)["']/.exec(attrs)?.[1] || fallback
}

const shortHash = (title: string) => createHash('sha1').update(title).digest('hex').slice(0, 10)

/** API 日志的日期在徽标而非标题里，先还原为带年份的日期段落。 */
export function parseOpenaiApi(html: string): Raw[] {
  let year = ''
  const dated = html.replace(/<h3\b[^>]*>\s*([A-Z][a-z]+),?\s+(20\d{2})\s*<\/h3>|<div\b[^>]*>\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\s*<\/div>/g, (whole, _month: string, y: string, day: string) => {
    if (y) { year = y; return whole }
    return year ? `<h4>${day}, ${year}</h4>` : whole
  })
  return parseDated(dated, 'https://developers.openai.com/api/docs/changelog', 'OpenAI')
}

/** 按日期及其子标题拆分日志；同一天的搜索 API 发布和模型升级各有独立锚点。 */
export function parseDated(html: string, home: string, brand: string): Raw[] {
  const headings = [...html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)]
  const dated: { start: number; end: number; level: number; date: string; id: string }[] = []
  let year: string | undefined
  for (const h of headings) {
    const text = stripHtml(h[3]).replace(/\u200b/g, '').trim()
    if (/^20\d{2}$/.test(text)) year = text
    const date = dateIn(text, year)
    if (date) {
      year = date.slice(0, 4)
      dated.push({ start: h.index!, end: h.index! + h[0].length, level: +h[1], date, id: anchor(h[2], date.slice(0, 10)) })
    }
  }
  const out: Raw[] = []
  for (let i = 0; i < dated.length; i++) {
    const day = dated[i]
    const end = dated[i + 1]?.start ?? html.length
    const section = html.slice(day.end, end)
    // Claude 产品日志的单项标题是加粗段落，DeepSeek / API 文档通常用子标题。
    const children = [...section.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>|<p\b[^>]*>\s*<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>\s*<\/p>/gi)]
      .filter((m) => !m[1] || +m[1] > day.level)
    if (!children.length) {
      const text = stripHtml(section).trim()
      const first = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(section)
      const title = first ? stripHtml(first[1]).slice(0, 200) : `${brand} 更新 · ${day.date.slice(0, 10)}`
      if (text) out.push({ title, summary: text.slice(0, 400), url: `${home}#${day.id}-${shortHash(title)}`, published: day.date, dateOnly: true })
      continue
    }
    children.forEach((h, j) => {
      const title = stripHtml(h[3] || h[4]).replace(/\u200b/g, '').trim()
      if (!title) return
      const id = anchor(h[2] || '', `${day.id}-${shortHash(title)}`)
      const summary = stripHtml(section.slice(h.index! + h[0].length, children[j + 1]?.index ?? section.length)).slice(0, 400)
      out.push({ title, summary, url: `${home}#${id}`, published: day.date, dateOnly: true })
    })
  }
  return [...new Map(out.map((r) => [r.url, r])).values()]
}

/** 官网新闻/文章卡片：只取带标题与发布日期的文章链接，跳过页脚和导航。 */
export function parseCards(html: string, home: string): Raw[] {
  const out = new Map<string, Raw>()
  for (const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL
    try { url = new URL(decode(a[1]), home) } catch { continue }
    if (url.hostname !== new URL(home).hostname || !/^\/(?:news|resources\/articles|blog)\/[^/]+\/?$/.test(url.pathname)) continue
    const text = stripHtml(a[2])
    const published = dateIn(text)
    const heading = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(a[2])
    if (!published || !heading) continue
    const title = stripHtml(heading[1]).trim()
    if (!title) continue
    const summary = text.slice(text.indexOf(title) + title.length).trim().slice(0, 400)
    out.set(url.href, { title: title.slice(0, 300), summary, url: url.href, published, dateOnly: true })
  }
  return [...out.values()]
}

