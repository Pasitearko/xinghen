import { motion } from 'motion/react'
import { ArrowUpRight, PenLine, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { Calendar } from '../components/Calendar'
import { Ticker } from '../components/ui'
import { api, type Company, type DiaryDay, type NewsFeed, type NewsItem, type Profile, type StudyToday } from '../lib/api'
import { cnDate, currentTerm, dateKey, greeting, lunar, timeAgo, weekday } from '../lib/date'
import { EASE_OUT, stagger } from '../lib/motion'
import { toast } from '../lib/store'
import './home.css'

/** 问候语逐字从模糊中浮现，同一次会话只播一次（BlurText 的做法）。 */
function Greeting({ text }: { text: string }) {
  const [played] = useState(() => {
    try {
      const seen = sessionStorage.getItem('xinghen.greeted')
      sessionStorage.setItem('xinghen.greeted', '1')
      return !!seen
    } catch {
      return false
    }
  })
  return (
    <h1 className="home-greet" aria-label={text}>
      {[...text].map((ch, i) => (
        <motion.span
          key={`${ch}${i}`}
          aria-hidden
          initial={played ? false : { opacity: 0, filter: 'blur(12px)', y: '0.25em' }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{ duration: 0.9, delay: 0.15 + i * 0.07, ease: EASE_OUT }}
        >
          {ch}
        </motion.span>
      ))}
    </h1>
  )
}

/** 对齐到整秒/整分刷新；切回标签页时立刻校准一次（后台时计时器会被浏览器放慢） */
function useNow(step = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let id = 0
    const tick = () => {
      setNow(new Date())
      id = window.setTimeout(tick, step - (Date.now() % step) + 20)
    }
    id = window.setTimeout(tick, step - (Date.now() % step) + 20)
    const onVisible = () => {
      if (document.hidden) return
      clearTimeout(id)
      tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [step])
  return now
}

function Clock() {
  // 只显示时和分，整分钟刷新一次就够
  const now = useNow(60_000)
  const hh = now.getHours()
  const mm = now.getMinutes()
  return (
    <div className="home-clock" aria-label={`${hh} 点 ${mm} 分`}>
      <Ticker value={hh} format={(n) => String(n).padStart(2, '0')} />
      <span className="home-clock-colon">:</span>
      <Ticker value={mm} format={(n) => String(n).padStart(2, '0')} />
    </div>
  )
}

const COMPANY: Record<Company, { name: string; sub: string }> = {
  anthropic: { name: 'Anthropic', sub: '模型 · Claude · 官网动态' },
  openai: { name: 'OpenAI', sub: '模型 · Codex · 官网动态' },
  deepseek: { name: 'DeepSeek', sub: '模型 · 产品版本 · 官网动态' },
}

/** 官方写「官方」；Google 新闻的条目显示原始媒体名（解析时放在摘要里） */
function sourceLabel(n: NewsItem) {
  if (n.category === 'official') return n.source_name
  if (n.category === 'aggregate') return n.summary.replace(/^来自/, '') || 'Google 新闻'
  return n.source_name
}

const EVENT_LABEL: Record<NewsItem['event_kind'], string> = {
  'model-release': '模型发布', 'model-upgrade': '模型升级', 'product-update': '产品与版本', 'website-news': '官网动态',
}

function NewsColumn({ company, items, ready, index }: { company: Company; items: NewsItem[]; ready: boolean; index: number }) {
  const c = COMPANY[company]
  return (
    <section className={`glass news-col news-col--${company}`} style={{ ['--i' as string]: index }} aria-label={`${c.name} 的消息`}>
      <header className="news-col-head">
        <h3 className="news-col-name">
          <span className="news-dot" aria-hidden />
          {c.name}
          {ready && <span className="news-col-count">{items.length}</span>}
        </h3>
        <p className="news-col-sub">{c.sub}</p>
      </header>
      <ul className="news-list">
        {!ready && Array.from({ length: 5 }, (_, i) => <li key={i} className="skeleton news-skel" />)}
        {ready && !items.length && <li className="news-none">过去 24 小时没有 {c.name} 的模型、产品版本或官网新动态。</li>}
        {items.map((n, i) => (
          <motion.li key={n.event_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + stagger(i, 0.04, 0.5), duration: 0.5, ease: EASE_OUT }}>
            <a className="news-item" href={n.url} target="_blank" rel="noreferrer noopener">
              <span className="news-meta">
                <span className={`news-src news-src--${n.category}`}>{sourceLabel(n)}</span>
                <span>{timeAgo(n.published_at || n.fetched_at)}</span>
                {n.reports > 1 && <span className="news-heat">{n.reports} 条报道</span>}
              </span>
              <span className="news-tags">
                <span>{EVENT_LABEL[n.event_kind]}</span>
                {n.companies.length > 1 && <span>关联 {n.companies.map((key) => COMPANY[key].name).join(' · ')}</span>}
              </span>
              <span className="news-item-title">{n.title}</span>
              {n.category === 'official' && n.summary && <span className="news-sum">{n.summary}</span>}
              <ArrowUpRight size={14} className="news-go" aria-hidden />
            </a>
            {n.links.length > 1 && (
              <details className="news-reports">
                <summary>查看 {n.links.length} 条相关报道</summary>
                <ul>{n.links.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer noopener">{link.source_name}：{link.title}</a></li>)}</ul>
              </details>
            )}
          </motion.li>
        ))}
      </ul>
    </section>
  )
}

/** 每日焦点：三家各占一列，列头错落排开，像三颗高低不一的星 */
function NewsBoard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['news'], queryFn: () => api.get<NewsFeed>('/api/news/feed'), refetchInterval: 5 * 60_000 })
  const refresh = useMutation({
    mutationFn: () => api.post<NewsFeed & { results: { ok: boolean }[] }>('/api/news/refresh'),
    onSuccess: (d) => {
      qc.setQueryData(['news'], d)
      const bad = d.results.filter((r) => !r.ok).length
      toast(bad ? `已更新，${bad} 个来源暂时连不上` : '资讯已更新', bad ? 'info' : 'ok')
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const cols = data?.companies || (['anthropic', 'openai', 'deepseek'] as const).map((key) => ({ key, items: [] as NewsItem[] }))
  return (
    <section className="news-board" aria-label="每日焦点">
      <header className="news-board-head rise">
        <h2 className="news-board-title">每日焦点</h2>
        <p className="news-board-meta faint">
          近 24 小时
          {data?.refreshed_at ? `，${timeAgo(data.refreshed_at)}更新` : '，还没有抓取过'}
          {data && data.failed.length > 0 && <span title={data.failed.map((f) => `${f.name}：${f.error}`).join('\n')}>，{data.failed.length} 个来源上次没连上</span>}
        </p>
        <button className="icon-btn" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="立即更新资讯" title="立即更新">
          <RefreshCw size={16} className={refresh.isPending || data?.refreshing ? 'spin' : ''} />
        </button>
      </header>
      <div className="news-cols">
        {cols.map((c, i) => (
          <NewsColumn key={c.key} company={c.key} items={c.items} ready={!!data} index={i} />
        ))}
      </div>
    </section>
  )
}

function TodayPanel({ today }: { today: string }) {
  const [, go] = useLocation()
  const { data: day } = useQuery({ queryKey: ['diary-day', today], queryFn: () => api.get<DiaryDay>(`/api/diary/day/${today}`) })
  const { data: study } = useQuery({ queryKey: ['study-today'], queryFn: () => api.get<StudyToday>('/api/study/today') })
  const { data: stats } = useQuery({ queryKey: ['diary-stats'], queryFn: () => api.get<{ streak: number; entries: number; chars: number }>('/api/diary/stats') })
  const words = day?.entries.reduce((s, e) => s + e.char_count, 0) ?? 0
  const n = day?.entries.length ?? 0
  return (
    <section className="glass panel-pad today">
      <div className="today-line">
        {n ? (
          <p className="today-main">
            今天写了 <b>{n}</b> 篇，共 <b>{words}</b> 字
          </p>
        ) : (
          <p className="today-main">今天还没有写日记</p>
        )}
        <button className="btn btn--primary" onClick={() => go('/diary')}>
          <PenLine size={15} />
          {n ? '继续写' : '写今天的日记'}
        </button>
      </div>
      <dl className="today-stats">
        <div>
          <dt>连续书写</dt>
          <dd>
            <Ticker value={stats?.streak ?? 0} />
            <small>天</small>
          </dd>
        </div>
        <div>
          <dt>今日专注</dt>
          <dd>
            <Ticker value={Math.round((study?.stats.seconds ?? 0) / 60)} />
            <small>分钟</small>
          </dd>
        </div>
        <div>
          <dt>累计字数</dt>
          <dd>
            <Ticker value={stats?.chars ?? 0} />
          </dd>
        </div>
      </dl>
    </section>
  )
}

function OnThisDay() {
  const [, go] = useLocation()
  const { data } = useQuery({
    queryKey: ['on-this-day'],
    queryFn: () => api.get<{ id: number; date_key: string; title: string; excerpt: string }[]>('/api/archive/on-this-day'),
    staleTime: 3600_000,
  })
  if (!data?.length) return null
  return (
    <section className="glass panel-pad otd">
      <h2 className="panel-title">那年今日</h2>
      {data.slice(0, 3).map((d) => (
        <button key={d.id} className="otd-item" onClick={() => go(`/diary?date=${d.date_key}`)}>
          <span className="otd-year">{d.date_key.slice(0, 4)}</span>
          <span>
            <span className="otd-title">{d.title || '无题'}</span>
            <span className="otd-ex">{d.excerpt}</span>
          </span>
        </button>
      ))}
    </section>
  )
}

export default function Home() {
  const [, go] = useLocation()
  const now = useNow(60_000)
  const today = dateKey(now)
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: () => api.get<Profile>('/api/profile'), staleTime: Infinity })
  const lu = lunar(now)
  const term = currentTerm(now)
  const name = profile?.name
  const hello = `${greeting(now.getHours())}${name ? `，${name}` : ''}`
  const tag = [lu && `农历${lu.month}${lu.day}`, term && (term.days === 0 ? `今日${term.name}` : `${term.name}第${cnNum(term.days + 1)}天`)].filter(Boolean) as string[]

  return (
    <div className="page home">
      <div className="home-left">
        <header className="home-hero rise">
          <div className="home-clock-row">
            <Clock />
            {/* 竖排题签：农历与节气，像手帐页边的落款 */}
            <p className="home-tag">
              {tag.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </p>
          </div>
          <Greeting key={hello} text={hello} />
          <p className="home-date">
            {cnDate(today)}，{weekday(today)}
          </p>
          {profile?.motto && <p className="home-motto">{profile.motto}</p>}
        </header>
        <div className="home-desk">
          <div className="home-stack">
            <TodayPanel today={today} />
            <OnThisDay />
          </div>
          <section className="glass panel-pad home-cal">
            <Calendar today={today} onPick={(d) => go(d === today ? '/diary' : `/diary?date=${d}`)} />
          </section>
        </div>
      </div>
      <NewsBoard />
    </div>
  )
}

const CN = '〇一二三四五六七八九十'
function cnNum(n: number) {
  if (n <= 10) return CN[n]
  if (n < 20) return `十${CN[n - 10]}`
  return `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`
}
