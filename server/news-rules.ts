import { createHash } from 'node:crypto'
import { COMPANIES, type Company, type EventKind, type ItemRow, type Raw, type Source } from './news-types.ts'

const COMPANY_WORDS: Record<Company, RegExp> = {
  anthropic: /\banthropic\b|\bclaude\b|\b(?:opus|sonnet|haiku|fable|mythos)[-\s]?\d|克劳德|克勞德/i,
  openai: /\bopenai\b|\bchatgpt\b|\bgpt[-‑\s]?(?:\d|oss|image|realtime)|\bcodex\b|\bsora\b|\bo[134](?:\b|-)|\bdall[-·\s]?e\b|\bwhisper\b/i,
  deepseek: /\bdeepseek\b|深度求索/i,
}

export function classify(text: string): Company[] {
  return COMPANIES.filter((c) => COMPANY_WORDS[c].test(text))
}

const MODEL_PATTERNS = [
  /\bgpt[-\s]?(?:oss[-\s]?)?\d+[a-z]?(?:\.\d+)*(?:[-\s](?:terra|sol|astra|luna|mini|nano|pro|turbo|instant|thinking|image|realtime|oss|preview|\d{4}))*/gi,
  /\b(?:claude[-\s]?)?(?:opus|sonnet|haiku|fable|mythos)[-\s]?\d+(?:\.\d+)*(?:[-\s](?:\d{4}|preview))*/gi,
  /\bclaude[-\s]?\d+(?:\.\d+)*(?:[-\s](?:opus|sonnet|haiku|fable|mythos))?/gi,
  /\bdeepseek[-\s]?(?:v|r)\d+(?:\.\d+)*(?:[-\s](?:flash|pro|lite|vision|coder|prover|exp|terminus|speciale|preview|base|\d{4}))*/gi,
  /\bdeepseek[-\s](?:ocr|vl|math|coder|prover)(?:[-\s]?(?:v?\d+(?:\.\d+)*))?/gi,
  /\b(?:sora|whisper|dall[-\s]?e)[-\s]?\d+(?:\.\d+)*/gi,
  /\bo[134](?:[-\s](?:mini|pro|preview))?\b/gi,
]

function normalized(text: string) {
  return text.toLowerCase().replace(/[‑–—]/g, '-').replace(/\s+/g, ' ').trim()
}

export function modelKeys(text: string) {
  const keys = new Set<string>()
  for (const pattern of MODEL_PATTERNS) {
    for (const match of normalized(text).matchAll(pattern)) {
      let key = match[0].replace(/^claude[-\s]?(?=(?:opus|sonnet|haiku|fable|mythos))/, '').replace(/\s+/g, '-')
      key = key.replace(/^gpt(?=\d)/, 'gpt-').replace(/^deepseek(?=[vr]\d)/, 'deepseek-')
        .replace(/^(opus|sonnet|haiku|fable|mythos)(?=\d)/, '$1-')
        .replace(/^(deepseek-(?:ocr|vl|math|coder|prover))(?=\d)/, '$1-')
      key = key.replace(/^claude-(\d+(?:\.\d+)*)-(opus|sonnet|haiku|fable|mythos)$/, '$2-$1')
      keys.add(key)
    }
  }
  // “Claude 5.5”与“Claude Opus 5.5”同在标题时，避免泛称干扰精确版本。
  return [...keys].filter((k) => !/^claude-\d/.test(k) || ![...keys].some((other) => other.endsWith(k.slice(6)) && other !== k)).sort()
}

const RELEASE = /\bintroduc(?:e[sd]?|ing)\b|\blaunch(?:es|ed|ing)?\b|\breleas(?:e[sd]?|ing)\b|\broll(?:s|ed|ing)? out\b|\bnow available\b|\bopen[- ]weights?\b|\bopen[- ]sourc(?:e[sd]?|ing)\b|发布|發布|推出|上线|上線|上新|开放|開放|开源|開源|正式版|预览版|預覽版/i
const UPGRADE = /\bupdat(?:e[sd]?|ing)\b|\bupgrad(?:e[sd]?|ing)\b|\bimprov(?:e[sd]?|ing|ement)\b|升级|升級|更新|增强|增強|改进|改進/i
const PRODUCT_CHANGE = /\badds?\b|\bsupports?\b|\bcomes? to\b|\bbring(?:s|ing)?\b|\bexpands?\b|\bships?\b|新增|支持|支援|接入|整合|集成|扩展|擴展|版本|功能/i
const NOT_EVENT = /传闻|傳聞|爆料|据传|據傳|或将|或將|即将|即將|有望|预计|預計|疑似|泄露|洩露|\brumou?rs?\b|\bleak(?:s|ed)?\b|\breportedly\b|\bmight\b|\bcould\b|\bexpected\b|\bcoming soon\b|评测|評測|测评|測評|实测|實測|横评|橫評|教程|攻略|怎么|如何|体验|體驗|\breview\b|\bbenchmark\b|\btutorial\b|\bhow to\b|\bversus\b|\bvs\.?\s/i
const BUSINESS = /融资|融資|估值|上市|招股|营收|營收|财报|財報|离职|離職|跳槽|访谈|訪談|采访|採訪|\bfunding\b|\bvaluation\b|\bipo\b|\brevenue\b|\binterview\b/i
const DERIVATIVE = /\balternative to\b|\bclone\b|\bshow hn\b|替代品|平替|复刻|複刻|开源替代|開源替代/i

function eventModels(title: string) {
  // 后半句常拿上一代/竞品作比较，它们不是这次发布的模型；厂商关联仍保留。
  const headline = title.split(/(?:相比|相较|相較|较前代|較前代|对比|對比|比肩|超越|超过|超過|胜过|勝過|击败|擊敗|碾压|甩开|甩開|Token效率|性能为|性能為|价格仅|價格僅|outperforms?\b|beats?\b|compared (?:with|to))/i)[0]
  const keys = modelKeys(headline)
  // 聚合标题有时附带被截短的导语，如 “GPT-6.1 Terra … 新模型 GPT-6.1”。
  return keys.filter((key) => !keys.some((other) => other.startsWith(`${key}-`)))
}

function hasTargetSubject(title: string) {
  const target = /\b(?:openai|anthropic|claude|deepseek|codex|gpt|opus|sonnet|haiku|fable|mythos|sora|whisper)\b|深度求索|克劳德/i.exec(title)
  const action = /introduc|launch|releas|roll(?:s|ed|ing)? out|updat|upgrad|\badds?\b|\bsupports?\b|\bcomes? to\b|\bnow available\b|发布|發布|推出|上线|上線|开源|開源|升级|升級|更新|新增|支持|支援|接入|开放|開放/i.exec(title)
  if (!target || !action) return false
  if (target.index <= action.index) return action.index - target.index <= 48
  // “发布：Claude …”可收；“第三方软件发布/接入 Claude …”不属于 Claude 自身更新。
  return /^(?:(?:重磅|刚刚|正式|全新)[！!：:\s]*)?(?:released?|introducing|发布|發布|推出|上线|上線|开源|開源)\s*[:：]?\s*(?:OpenAI|Anthropic|GPT|Claude|DeepSeek|Codex|Opus|Sonnet)/i.test(title)
}

function isProductEvent(title: string, product: string | null) {
  if (!product) return false
  if (product === 'codex' || product === 'claude-code') return true
  if (/\b(?:app|api|chat|harness|cli|desktop|cowork|duet)\b|网页版|網頁版|桌面|客户端|客戶端|移动端|移動端|应用|應用|聊天|功能|版本|记忆|記憶|更新日志/i.test(title)) return true
  // 厂商品牌同时也是聊天产品名时，要求它是发布/更新动作的主体。
  return /(?:claude|deepseek|深度求索)[\s：:，,]{0,3}(?:正式)?(?:新增|发布|發布|推出|更新|升级|升級|上线|上線|支持|开放|開放)|\b(?:claude|deepseek)\s+(?:now\s+)?(?:adds?|launches?|releases?|updates?|supports?|rolls? out)\b/i.test(title)
}

function productName(title: string, source: Source) {
  if (source.product) return source.product.toLowerCase().replace(' ', '-')
  if (/\bcodex\b/i.test(title)) return 'codex'
  if (/\bclaude[-\s]code\b/i.test(title)) return 'claude-code'
  if (/\bclaude\b|克劳德|克勞德/i.test(title)) return 'claude'
  if (/\bdeepseek\b|深度求索/i.test(title)) return 'deepseek'
  return null
}

export interface Analysis {
  companies: Company[]
  kind: EventKind
  models: string[]
  product: string | null
  version: string | null
}

export function analyze(item: Pick<Raw, 'title' | 'summary'>, source: Source): Analysis | null {
  const companies = classify(item.title)
  if (source.company && !companies.includes(source.company)) companies.push(source.company)
  if (!companies.length || !item.title.trim()) return null
  const models = eventModels(item.title)
  // 裸模型名（如 Opus 5.5）也要关联到厂商；外部报道仍须明确指向三家之一。
  const product = productName(item.title, source)
  const version = product && !models.length
    ? /\b(?:rust-v|v)?(\d+\.\d+(?:\.\d+)?(?:-(?:alpha|beta|rc|preview)[\w.-]*)?)\b/i.exec(item.title)?.[1]?.toLowerCase() || null
    : null
  let kind: EventKind | null = null
  const modelHeadline = models.some((model) => normalized(item.title).replace(/claude|[\s-]/g, '') === model.replace(/-/g, ''))
  if (source.scope === 'website') {
    kind = models.length && (RELEASE.test(item.title) || UPGRADE.test(item.title) || modelHeadline)
      ? RELEASE.test(item.title) || modelHeadline ? 'model-release' : 'model-upgrade'
      : product && (RELEASE.test(item.title) || UPGRADE.test(item.title) || PRODUCT_CHANGE.test(item.title) || !!version)
        ? 'product-update' : 'website-news'
  } else if (source.scope === 'product' && source.kind === 'github') {
    kind = 'product-update'
  } else {
    if (NOT_EVENT.test(item.title) || BUSINESS.test(item.title) || DERIVATIVE.test(item.title)) return null
    const trustedProduct = source.scope === 'product' && source.product && new RegExp(source.product.replace(' ', '[-\\s]'), 'i').test(item.title)
    if (!trustedProduct && /等大模型|等模型|解决方案|解決方案|助力企业|助力企業|赋能企业|賦能企業/i.test(item.title)) return null
    const action = RELEASE.test(item.title) || UPGRADE.test(item.title)
    const targetAction = hasTargetSubject(item.title)
    const versionHeadline = !!version && /^\s*(?:(?:OpenAI|Anthropic)\s+)?(?:Codex|Claude|DeepSeek|深度求索)/i.test(item.title)
    if ((models.length || /模型|\bmodel\b/i.test(item.title)) && action && (targetAction || source.scope === 'model')) {
      kind = RELEASE.test(item.title) ? 'model-release' : 'model-upgrade'
    } else if (product && isProductEvent(item.title, product) && (targetAction || versionHeadline || trustedProduct)) {
      // Codex 综合订阅偶尔含有 ChatGPT/iOS 更新，不能因来源名而扩大范围。
      if (source.product === 'Codex' && !/\bcodex\b/i.test(item.title)) return null
      kind = 'product-update'
    }
  }
  return kind ? { companies: COMPANIES.filter((c) => companies.includes(c)), kind, models, product, version } : null
}

/** 保留更新日志的锚点：同一个页面的不同日期/条目不能被当作同一条。 */
export function canonicalUrl(value: string) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    return url.toString()
  } catch {
    return value.trim()
  }
}

const FACETS: [string, RegExp][] = [
  ['price', /降价|价格|價格|定价|定價|\bpric(?:e|es|ing)\b|\bcosts?\b/i],
  ['context', /上下文|\bcontext\b/i],
  ['vision', /视觉|視覺|图像|圖像|多模态|\bvision\b|\bmultimodal\b/i],
  ['search', /搜索|搜尋|\bsearch\b/i],
  ['audio', /语音|語音|\baudio\b|\bvoice\b/i],
  ['tools', /工具调用|工具調用|\btool[- ](?:use|calling)\b/i],
  ['reasoning', /推理|思考|\breasoning\b|\bthinking\b/i],
  ['coding', /编程|編程|\bcoding\b/i],
  ['memory', /记忆|記憶|\bmemory\b/i],
  ['security', /安全|\bsecurity\b/i],
  ['availability', /接入|入驻|登上|\bcomes? to\b|\bavailable (?:on|in|through)\b/i],
]

function terms(text: string) {
  const t = normalized(text).replace(/openai|anthropic|claude|deepseek|codex|深度求索|刚刚|重磅|突发|最新|官宣|宣布|发布|推出|更新|升级|introducing|launch(?:es|ed)?|release[sd]?|updates?|upgrades?/g, ' ')
  const words = new Set(t.match(/[a-z][a-z0-9.-]{2,}/g)?.filter((w) => !/^(the|and|for|with|new|its|now|from|has|that|this|are|will)$/.test(w)))
  for (const run of t.match(/[\p{Script=Han}]+/gu) || []) for (let i = 0; i + 1 < run.length; i++) words.add(run.slice(i, i + 2))
  return words
}

interface Candidate { row: ItemRow; source: Source; analysis: Analysis }

function identity(c: Candidate) {
  const a = c.analysis
  if (a.kind === 'model-release' && a.models.length) {
    // 模型首发与该模型接入另一平台是不同事件。
    if (FACETS.find(([key, re]) => key === 'availability' && re.test(c.row.title))) return null
    return `release:${a.models.join('+')}`
  }
  if (a.kind === 'product-update' && a.product && a.version) return `version:${a.product}:${a.version}`
  return null
}

function sameEvent(a: Candidate, b: Candidate) {
  if (a.row.url && canonicalUrl(a.row.url) === canonicalUrl(b.row.url)) return true
  if (!a.analysis.companies.some((c) => b.analysis.companies.includes(c))) return false
  const left = identity(a), right = identity(b)
  if (left || right) return !!left && left === right
  if (a.analysis.kind !== b.analysis.kind) return false
  if (a.analysis.models.join('|') !== b.analysis.models.join('|')) return false
  if (a.analysis.product !== b.analysis.product) return false
  const facets = (c: Candidate) => FACETS.filter(([, re]) => re.test(c.row.title)).map(([key]) => key).join('|')
  if (facets(a) !== facets(b)) return false
  const x = terms(a.row.title), y = terms(b.row.title)
  if (x.size < 3 || y.size < 3) return normalized(a.row.title) === normalized(b.row.title)
  let hit = 0
  for (const word of x) if (y.has(word)) hit++
  // 比较两条原文，而不是累积整组关键词，防止 A≈B、B≈C 最终误吞完全不同的 A/C。
  return hit / Math.min(x.size, y.size) >= 0.8 && hit / Math.max(x.size, y.size) >= 0.6
}

export function clusterEvents(rows: ItemRow[], sources: Map<string, Source>) {
  const candidates: Candidate[] = []
  for (const row of rows) {
    const source = sources.get(row.source_key)
    if (!source) continue
    const analysis = analyze(row, source)
    if (analysis) candidates.push({ row, source, analysis })
  }
  // 顺序固定；先处理官方，外部比较报道不能充当桥梁把两场独立发布串起来。
  candidates.sort((a, b) => Number(b.source.category === 'official') - Number(a.source.category === 'official') || a.row.id - b.row.id)
  const clusters: Candidate[][] = []
  for (const c of candidates) {
    const cluster = clusters.find((items) => items.every((other) => sameEvent(c, other)))
    if (cluster) cluster.push(c)
    else clusters.push([c])
  }
  return clusters.map((items) => {
    const ordered = [...items].sort((a, b) => Number(b.source.category === 'official') - Number(a.source.category === 'official') || (a.row.published_at || a.row.fetched_at).localeCompare(b.row.published_at || b.row.fetched_at) || a.row.id - b.row.id)
    const representative = ordered[0]
    const companies = COMPANIES.filter((c) => items.some((item) => item.analysis.companies.includes(c)))
    const links = [...new Map(ordered.map((c) => [canonicalUrl(c.row.url), { title: c.row.title, url: c.row.url, source_name: c.source.name }])).values()]
    const eventId = createHash('sha1').update(identity(representative) || canonicalUrl(representative.row.url)).digest('hex').slice(0, 20)
    return { rep: representative.row, companies, kind: representative.analysis.kind, event_id: eventId, reports: links.length, links,
      latest: Math.max(...items.map((c) => Date.parse(c.row.published_at || c.row.fetched_at))) }
  })
}
