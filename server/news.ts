// 每日焦点：三家的模型发布/升级、Codex/Claude/DeepSeek 产品与版本，以及官网动态。
// 只「读」这些公开页面，不发送任何私人数据。单个来源失败不影响其他来源，并如实记录失败原因。
import { createHash } from 'node:crypto'
import { all, get, kvGet, kvSet, run, tx } from './db.ts'
import { dayKey, nowIso, todayKey } from './time.ts'

import { COMPANIES, type Source, type Raw, type ItemRow } from './news-types.ts'
import { analyze, canonicalUrl, clusterEvents } from './news-rules.ts'
import { parseFeed, parseGnews, parseGithub, parseAnthropic, parseHn, parseHf, parseDeepseek, parseDated, parseCards, parseOpenaiApi } from './news-parsers.ts'
export { COMPANIES, type Company, type Source } from './news-types.ts'
export { classify } from './news-rules.ts'

export const SOURCES: Source[] = [
  // 官方：本身就属于某一家，不用再按标题判断
  { key: 'openai', brand: 'OpenAI', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', kind: 'rss', category: 'official', company: 'openai', scope: 'website', home: 'https://openai.com/news' },
  { key: 'anthropic', brand: 'Anthropic', name: 'Anthropic News', url: 'https://www.anthropic.com/news', kind: 'anthropic', category: 'official', company: 'anthropic', scope: 'website', home: 'https://www.anthropic.com/news' },
  { key: 'claude-code', brand: 'Anthropic', name: 'Claude Code 版本', url: 'https://api.github.com/repos/anthropics/claude-code/releases?per_page=10', kind: 'github', category: 'official', company: 'anthropic', scope: 'product', product: 'Claude Code', home: 'https://github.com/anthropics/claude-code/releases' },
  { key: 'deepseek', brand: 'DeepSeek', name: 'DeepSeek 更新日志', url: 'https://api-docs.deepseek.com/updates/', kind: 'deepseek', category: 'official', company: 'deepseek', scope: 'website', home: 'https://api-docs.deepseek.com/updates/' },
  { key: 'codex', brand: 'OpenAI', name: 'Codex 官方更新', url: 'https://developers.openai.com/codex/changelog/rss.xml', kind: 'rss', category: 'official', company: 'openai', scope: 'product', product: 'Codex', home: 'https://developers.openai.com/codex/changelog' },
  { key: 'codex-releases', brand: 'OpenAI', name: 'Codex 版本发布', url: 'https://api.github.com/repos/openai/codex/releases?per_page=20', kind: 'github', category: 'official', company: 'openai', scope: 'product', product: 'Codex', home: 'https://github.com/openai/codex/releases' },
  { key: 'openai-api', brand: 'OpenAI', name: 'OpenAI API 更新日志', url: 'https://developers.openai.com/api/docs/changelog', kind: 'openai-api', category: 'official', company: 'openai', scope: 'website', home: 'https://developers.openai.com/api/docs/changelog' },
  { key: 'claude-product', brand: 'Anthropic', name: 'Claude 产品更新', url: 'https://support.claude.com/en/articles/12138966-release-notes', kind: 'dated', category: 'official', company: 'anthropic', scope: 'website', home: 'https://support.claude.com/en/articles/12138966-release-notes' },
  { key: 'claude-platform', brand: 'Anthropic', name: 'Claude Platform 更新', url: 'https://platform.claude.com/docs/en/release-notes/feed.xml', kind: 'rss', category: 'official', company: 'anthropic', scope: 'website', home: 'https://platform.claude.com/docs/en/release-notes/overview' },
  { key: 'claude-articles', brand: 'Anthropic', name: 'Claude 官网动态', url: 'https://claude.com/resources/articles', kind: 'cards', category: 'official', company: 'anthropic', scope: 'website', home: 'https://claude.com/resources/articles' },
  { key: 'deepseek-news', brand: 'DeepSeek', name: 'DeepSeek 官网动态', url: 'https://www.deepseek.com/news/', kind: 'cards', category: 'official', company: 'deepseek', scope: 'website', home: 'https://www.deepseek.com/news/' },
  // 官方开放模型仓库仅跟踪新模型发布，不把修改模型卡当成模型升级。
  { key: 'hf-deepseek', brand: 'Hugging Face', name: 'Hugging Face · deepseek-ai', url: hf('deepseek-ai'), kind: 'hf', category: 'official', company: 'deepseek', scope: 'model', home: 'https://huggingface.co/deepseek-ai' },
  { key: 'hf-openai', brand: 'Hugging Face', name: 'Hugging Face · openai', url: hf('openai'), kind: 'hf', category: 'official', company: 'openai', scope: 'model', home: 'https://huggingface.co/openai' },
  // 媒体与社区：只收模型发布/升级、指定产品与版本动态，排除评测、传闻和公司杂讯。
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

function hf(author: string) {
  return `https://huggingface.co/api/models?author=${author}&sort=createdAt&direction=-1&limit=20`
}

function gnews(q: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:1d`)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
}

// ---------- 抓取与入库 ----------
const UA = 'Mozilla/5.0 (X11; Linux x86_64) XinghenNews/2.0 (+local personal use)'

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/html, application/json;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function dedupKey(src: Source, r: Raw) {
  return createHash('sha1').update(r.url ? canonicalUrl(r.url) : `${src.key}|${r.title}`).digest('hex').slice(0, 32)
}

/** 分派解析器也用于离线样例验证，不触发抓取或写库。 */
export function parseSource(src: Source, text: string): Raw[] {
  switch (src.kind) {
    case 'rss': return parseFeed(text)
    case 'gnews': return parseGnews(text)
    case 'github': return parseGithub(text, src.product || src.brand)
    case 'anthropic': return parseAnthropic(text)
    case 'hn': return parseHn(text)
    case 'hf': return parseHf(text, src.company === 'openai' ? 'OpenAI' : 'DeepSeek')
    case 'dated': return parseDated(text, src.home, src.brand)
    case 'cards': return parseCards(text, src.home)
    case 'deepseek': return parseDeepseek(text)
    case 'openai-api': return parseOpenaiApi(text)
  }
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
    const parsed = parseSource(src, text)
    if (!parsed.length && src.kind !== 'rss') throw new Error('页面结构可能变了：没解析出任何条目')
    // 抓取与展示使用同一套规则，已有缓存中的无关报道也会立即隐藏。
    const items = parsed.filter((r) => analyze(r, src))
    const fetched = nowIso()
    // 第一次抓某个来源时，没有发布时间的旧条目不能算作「今天的新闻」
    const firstRun = !sourceState(src.key)?.last_success_at
    const seen = new Set(kvGet<string[]>(`news.seen.${src.key}`, []))
    const limit = Date.now() + 2 * 3600_000
    for (const r of items) if (r.published && Date.parse(r.published) > limit) r.published = fetched
    // 只有日期的条目不能当成那天的 0 点：0 点到现在早就过了 24 小时，当天的发布会被误当旧闻丢掉
    // （GPT-6.1 Terra 就是这样漏掉的）。改按本机第一次看到它的时刻算，但不晚于那一天在美西结束的时刻
    for (const r of items) {
      if (!r.dateOnly || !r.published) continue
      const day = Date.parse(r.published)
      r.published = new Date(Math.max(day, Math.min(Date.now(), day + 31 * 3600_000))).toISOString()
    }
    // 只收最新的：发布超过 FRESH_HOURS 的不入库；没有发布时间的只在「后来新出现」时才算新
    const fresh = Date.now() - FRESH_HOURS * 3600_000
    const recent = items.filter((r) => (r.published ? Date.parse(r.published) >= fresh : !firstRun && !seen.has(dedupKey(src, r))))
    let added = 0
    tx(() => {
      for (const r of recent.slice(0, 40)) {
        const res = run(
          // 同一个链接已经被别的来源收过（比如 Hacker News 直接转贴官方原文）：官方来源接手这一条，
          // 换成官方的标题和摘要，发布时间取两者中更早的；非官方来源撞上就跳过
          `INSERT INTO news_items(dedup_key, brand, source_key, title, summary, url, published_at, fetched_at, published_day)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedup_key) DO ${
             src.category === 'official'
               ? `UPDATE SET brand = excluded.brand, source_key = excluded.source_key, title = excluded.title, summary = excluded.summary,
                    published_at = MIN(COALESCE(news_items.published_at, excluded.published_at), COALESCE(excluded.published_at, news_items.published_at))
                  WHERE news_items.source_key <> excluded.source_key`
               : 'NOTHING'
           }`,
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
      kvSet(`news.seen.${src.key}`, items.map((r) => dedupKey(src, r)))
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

const META = new Map(SOURCES.map((s) => [s.key, s]))
const PER_COMPANY = 12
const PER_SOURCE = 8

export function feed() {
  const since = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString()
  const sources = sourceList()
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.key))
  const rows = all<ItemRow>(
    'SELECT * FROM news_items WHERE COALESCE(published_at, fetched_at) >= ? ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC LIMIT 600', since,
  ).filter((r) => enabled.has(r.source_key))
  const now = Date.now()
  const ranked = clusterEvents(rows, META).map((event) => {
    const official = META.get(event.rep.source_key)?.category === 'official'
    const boost = official ? event.kind === 'website-news' ? 2 : 10 : 0
    return { ...event, score: 8 * Math.log2(1 + event.reports) + boost - (now - event.latest) / 3600_000 / 1.6 }
  }).sort((a, b) => b.score - a.score || a.event_id.localeCompare(b.event_id))
  const per = new Map<string, number>()
  const companies = COMPANIES.map((company) => {
    const items = []
    for (const event of ranked) {
      if (!event.companies.includes(company)) continue
      const r = event.rep, source = META.get(r.source_key)!
      const key = `${company}:${source.key}`
      if ((per.get(key) || 0) >= PER_SOURCE || items.length >= PER_COMPANY) continue
      per.set(key, (per.get(key) || 0) + 1)
      items.push({ ...r, company, companies: event.companies, event_id: event.event_id, event_kind: event.kind,
        category: source.category, source_name: source.name, dated: !!r.published_at, reports: event.reports, links: event.links })
    }
    return { key: company, items }
  })
  return {
    today: todayKey(), companies,
    refreshed_at: kvGet<string | null>('news.refreshed_at', null),
    refreshing: isRefreshing(),
    failed: sources.filter((s) => s.enabled && s.status === 'failed').map((s) => ({ key: s.key, name: s.name, error: s.last_error })),
  }
}
