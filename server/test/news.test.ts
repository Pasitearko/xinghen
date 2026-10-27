import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { analyze, canonicalUrl, classify, clusterEvents, modelKeys } from '../news-rules.ts'
import { parseCards, parseDated, parseDeepseek, parseFeed, parseGithub, parseOpenaiApi } from '../news-parsers.ts'
import type { ItemRow, Source } from '../news-types.ts'

const DATA = mkdtempSync(join(tmpdir(), 'xinghen-news-test-'))
process.env.XINGHEN_DATA_DIR = DATA
const { ensureDirs } = await import('../paths.ts')
ensureDirs()
const { all, db, run } = await import('../db.ts')
const { feed, ensureSources, refreshAll, SOURCES } = await import('../news.ts')
after(() => { db.close(); rmSync(DATA, { recursive: true, force: true }) })

const media: Source = { key: 'media', brand: '媒体', name: '媒体', category: 'media', kind: 'rss', url: 'https://media.test/feed', home: 'https://media.test' }
const official: Source = { key: 'official', brand: 'OpenAI', name: '官网', category: 'official', kind: 'rss', url: 'https://openai.com/news/rss.xml', home: 'https://openai.com/news', company: 'openai', scope: 'website' }
const github: Source = { ...official, key: 'codex-releases', kind: 'github', scope: 'product', product: 'Codex' }
const codex: Source = { ...github, key: 'codex', kind: 'rss' }
const sources = new Map([media, official, github, codex].map((s) => [s.key, s]))
let id = 0
function row(title: string, source = media, url = `https://media.test/${id + 1}`): ItemRow {
  return { id: ++id, brand: source.brand, source_key: source.key, title, summary: '', url,
    published_at: new Date().toISOString(), fetched_at: new Date().toISOString(), published_day: '2026-10-27' }
}
const inspect = (title: string, source = media) => analyze({ title, summary: '' }, source)

test('标题可关联多家，也识别裸模型系列名', () => {
  assert.deepEqual(classify('Codex 新增 Claude 和 DeepSeek 支持'), ['anthropic', 'openai', 'deepseek'])
  assert.deepEqual(classify('Opus 5.5 发布'), ['anthropic'])
  assert.deepEqual(classify('奥特曼接受访谈'), [])
})

test('只收模型发布/升级与指定产品动态', () => {
  for (const title of ['OpenAI发布GPT-6.1 Terra', 'Claude Opus 5.5正式发布', 'DeepSeek-V4.1-Flash-1017升级', 'Codex新增记忆功能', 'Claude Code v2.1.311', 'DeepSeek App发布新版本']) {
    assert.ok(inspect(title), title)
  }
  for (const title of ['OpenAI融资估值上涨', 'Anthropic或将发布新模型', 'DeepSeek V4.1实测教程', 'Claude Code更新后如何使用', 'GPT-6.1 Terra vs Claude Opus 5.5', 'ChatGPT新增付款功能', 'Gemini发布新版本', 'OpenAI CEO interview about new model releases', 'DeepSeek might release R2']) {
    assert.equal(inspect(title), null, title)
  }
  for (const title of ['2026胡润百富榜发布：DeepSeek梁文锋首次上榜', '周鸿祎谈DeepSeek开源：企业要有自己的主权AI', 'DeepSeek开源的技术给行业带来了什么', 'DeepSeek开源真香，vLLM/SGLang连夜性能反超', 'Show HN: Hob - Open-source, on device alternative to Claude Cowork and ChatGPT']) {
    assert.equal(inspect(title), null, title)
  }
  for (const title of ['DeepSeek等大模型迭代升级：第一线AI安全方案助力企业规范人工智能数据交互', '智能体直接调用数字孪生开发平台！漂视网络新产品DPE赋形正式接入WorkBuddy与DeepSeek Harness生态', 'Cursor发布2.0新版本，新增Claude支持', 'OpenAI公布的GPT-6.1接口输出token定价标准为每百万个token收取5美元。目前该定价方案仅针对API调用场景，不同输入输出类型、用量阶梯可能会对应不同计费细则，实际使用时可以进一步参考官方发布的完整计价说明。']) {
    assert.equal(inspect(title), null, title)
  }
  assert.equal(inspect('DeepSeek-V4.1升级')?.kind, 'model-upgrade')
  assert.equal(inspect('OpenAI发布GPT-6.1 Terra')?.kind, 'model-release')
})

test('官网动态保留，不能将媒体公司杂讯伪装成官网动态', () => {
  assert.equal(inspect('Investing in the public benefit', official)?.kind, 'website-news')
  assert.equal(inspect('OpenAI融资公告', official)?.kind, 'website-news')
  assert.equal(inspect('OpenAI融资公告', media), null)
  assert.equal(inspect('GPT-6.1 Terra', official)?.kind, 'model-release')
})

test('Codex 综合订阅排除不属于 Codex 的产品更新', () => {
  assert.equal(inspect('ChatGPT for iOS', codex), null)
  assert.equal(inspect('ChatGPT新增付款功能', codex), null)
  assert.equal(inspect('Codex CLI Release: 0.164.0', codex)?.kind, 'product-update')
  assert.equal(inspect('GPT-6.1 Terra in Work and Codex', codex)?.kind, 'product-update')
  assert.equal(inspect('Codex 0.166.0-alpha.1（预发布）', github)?.kind, 'product-update')
})

test('版本识别区分 GPT-4、GPT-4o、模型变体与 dated snapshot', () => {
  assert.notDeepEqual(modelKeys('GPT-4'), modelKeys('GPT-4o'))
  assert.notDeepEqual(modelKeys('GPT-6.1 Terra'), modelKeys('GPT-6.1 Sol'))
  assert.notDeepEqual(modelKeys('DeepSeek-V4-Flash'), modelKeys('DeepSeek-V4-Flash-Base'))
  assert.notDeepEqual(modelKeys('DeepSeek-R1-0528'), modelKeys('DeepSeek-R1'))
  assert.deepEqual(modelKeys('Claude 5.5 Opus'), modelKeys('Claude Opus 5.5'))
  assert.deepEqual(modelKeys('GPT6.1 Terra'), modelKeys('GPT-6.1 Terra'))
  assert.deepEqual(modelKeys('Opus5.5'), modelKeys('Claude Opus 5.5'))
  assert.deepEqual(modelKeys('DeepSeekV4'), modelKeys('DeepSeek-V4'))
})

test('中英文同一模型首发合并，官方原文优先且保留其他报道链接', () => {
  const events = clusterEvents([row('OpenAI发布GPT-6.1 Terra'), row('GPT-6.1 Terra', official), row('OpenAI launches GPT-6.1 Terra')], sources)
  assert.equal(events.length, 1)
  assert.equal(events[0].rep.source_key, 'official')
  assert.equal(events[0].reports, 3)
})

test('竞品比较不制造第二个发布事件，但保留竞品厂商关联', () => {
  const events = clusterEvents([row('Introducing GPT-6.1 Terra', official), row('OpenAI推出GPT-6.1 Terra，Token效率为Claude Opus 5.5三倍')], sources)
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].companies, ['anthropic', 'openai'])
})

test('聚合标题的截断导语不把同一具体模型重复拆组', () => {
  assert.equal(clusterEvents([row('Introducing GPT-6.1 Terra', official), row('OpenAI发布GPT-6.1 Terra：更会操作电脑OpenAI宣布推出新模型GPT-6.1')], sources).length, 1)
})

test('同一模型的首发、上下文升级与价格调整不能误合并', () => {
  const events = clusterEvents([row('OpenAI发布GPT-6.1 Terra'), row('GPT-6.1 Terra更新，上下文扩展'), row('GPT-6.1 Terra更新价格')], sources)
  assert.equal(events.length, 3)
})

test('不同版本、不同变体、同时提到两个模型的报道分别保留', () => {
  const events = clusterEvents([row('DeepSeek发布V4新模型'), row('DeepSeek-V4-Flash正式发布'), row('DeepSeek-V4-Pro正式发布'), row('OpenAI发布GPT-6.1 Terra与GPT-6.1 Sol')], sources)
  assert.equal(events.length, 4)
})

test('Codex RSS 与 GitHub 同版合并，预发布和正式版分开', () => {
  const events = clusterEvents([row('Codex CLI Release: 0.164.0', codex), row('Codex rust-v0.164.0', github), row('Codex rust-v0.164.0-alpha.1', github)], sources)
  assert.equal(events.length, 2)
  assert.equal(events.find((e) => e.reports === 2)?.links.length, 2)
})

test('联合事件保留全部厂商关联，不因链接带追踪参数而重复', () => {
  const events = clusterEvents([
    row('Codex 发布新集成，支持 Claude 与 DeepSeek', official, 'https://openai.com/news/integration?utm_source=rss'),
    row('Codex 新增 Claude 和 DeepSeek 支持', media, 'https://openai.com/news/integration'),
  ], sources)
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].companies, ['anthropic', 'openai', 'deepseek'])
  assert.equal(events[0].reports, 1)
})

test('不同更新日志锚点不会被 URL 去重吞掉', () => {
  assert.notEqual(canonicalUrl('https://example.com/log#one'), canonicalUrl('https://example.com/log#two'))
  assert.equal(canonicalUrl('https://example.com/a?utm_source=x&b=2'), 'https://example.com/a?b=2')
})

test('DeepSeek 日志同一天的两个事件拆开，日期与锚点正确', () => {
  const rows = parseDeepseek('<h2 id="date-2026-10-17">Date: 2026-10-17</h2><h3 id="search-api">Opening up the search API</h3><p>搜索接口</p><h3 id="flash-1017">DeepSeek-V4.1-Flash-1017 Update</h3><p>模型升级</p><h2 id="date-2026-09-10">Date: 2026-09-10</h2><h3 id="flash">DeepSeek-V4.1-Flash Release</h3><p>首发</p>')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].published, rows[1].published)
  assert.notEqual(rows[0].url, rows[1].url)
  assert.equal(rows[1].summary, '模型升级')
  assert.equal(rows[2].published, '2026-09-10T00:00:00.000Z')
})

test('Claude 产品日志按日期及加粗子项拆分', () => {
  const rows = parseDated('<h2>October 2026</h2><h3 id="oct21">October 21, 2026</h3><p><b>Claude Duet research preview</b></p><p>New app.</p><p><strong>Claude Code update</strong></p><p>Fixes.</p>', 'https://support.claude.com/notes', 'Claude')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, 'Claude Duet research preview')
  assert.notEqual(rows[0].url, rows[1].url)
})

test('OpenAI API 日期徽标按月份补足年份，同日多事件不互相覆盖', () => {
  const rows = parseOpenaiApi('<h3>October, 2026</h3><div>Oct 26</div><p>Released GPT-6.1 Terra.</p><div>Oct 26</div><p>Updated the audio API.</p><h3>December, 2025</h3><div>Dec 1</div><p>Released GPT-5.1.</p>')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].published, '2026-10-26T00:00:00.000Z')
  assert.equal(rows[2].published, '2025-12-01T00:00:00.000Z')
  assert.notEqual(rows[0].url, rows[1].url)
  assert.equal(rows[0].title, 'Released GPT-6.1 Terra.')
})

test('新闻卡片只收带日期的文章，跳过导航与页脚，合并重复卡片', () => {
  const card = '<a href="/news/v4/"><span>2026 年 9 月 10 日</span><h2>DeepSeek V4发布</h2><p>新模型</p></a>'
  const rows = parseCards(card + card + '<a href="/news/old/"><h3>旧文章</h3></a>', 'https://www.deepseek.com/news/')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].url, 'https://www.deepseek.com/news/v4/')
  assert.equal(rows[0].published, '2026-09-10T00:00:00.000Z')
})

test('RSS/Atom 与 GitHub 解析不混用产品名，跳过草稿并标识预发布', () => {
  assert.equal(parseFeed('<feed><entry><title>Codex 1.0</title><link href="https://example.com/codex" rel="alternate"/><updated>2026-10-27T01:00:00Z</updated></entry></feed>')[0].url, 'https://example.com/codex')
  const rows = parseGithub(JSON.stringify([{ name: '1.0.0', html_url: 'https://example.com/release', published_at: '2026-10-27T01:00:00Z', prerelease: true }, { name: 'draft', draft: true }]), 'Codex')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'Codex 1.0.0（预发布）')
})

test('已有缓存也立即按新规则过滤；多家公司引用同一事件 ID', () => {
  ensureSources()
  const insert = (title: string, source: string, url: string, date = new Date().toISOString()) => run('INSERT INTO news_items(dedup_key, brand, source_key, title, url, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)', url, 'test', source, title, url, date, date)
  insert('OpenAI融资估值上涨', 'qbitai', 'https://media.test/funding')
  insert('Codex发布更新，新增Claude与DeepSeek支持', 'openai', 'https://openai.com/news/joint')
  insert('DeepSeek发布旧模型', 'qbitai', 'https://media.test/old', new Date(Date.now() - 25 * 3600_000).toISOString())
  const result = feed()
  for (const company of result.companies) {
    assert.equal(company.items.length, 1)
    assert.equal(company.items[0].title, 'Codex发布更新，新增Claude与DeepSeek支持')
  }
  assert.equal(new Set(result.companies.flatMap((c) => c.items.map((i) => i.event_id))).size, 1)
  run("UPDATE news_sources SET enabled = 0 WHERE key = 'openai'")
  assert.ok(feed().companies.every((c) => !c.items.length))
})

test('刷新入库也使用范围规则；无日期旧条目第二次抓取不冒充新消息', async () => {
  run('DELETE FROM news_items')
  run('UPDATE news_sources SET enabled = 0')
  run("UPDATE news_sources SET enabled = 1 WHERE key = 'qbitai'")
  let titles = ['OpenAI发布新模型', 'OpenAI融资估值上涨']
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(`<rss>${titles.map((title, i) => `<item><title>${title}</title><link>https://media.test/refresh-${i}</link></item>`).join('')}</rss>`)
  try {
    await refreshAll()
    await refreshAll()
    assert.equal(all('SELECT * FROM news_items').length, 0)
    titles = [...titles, 'Claude Code发布新版本']
    await refreshAll()
    assert.equal(all('SELECT * FROM news_items').length, 1)
    assert.equal(all<{ title: string }>('SELECT title FROM news_items')[0].title, 'Claude Code发布新版本')
    assert.ok(SOURCES.some((s) => s.key === 'codex-releases' && s.product === 'Codex'))
  } finally { globalThis.fetch = originalFetch }
})
