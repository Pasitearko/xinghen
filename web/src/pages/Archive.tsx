import { AnimatePresence, motion } from 'motion/react'
import { Download, FileArchive, FileText, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { Sheet, Tabs, Ticker } from '../components/ui'
import { api, type DiaryEntry, type ImportReport } from '../lib/api'
import { addDays, cnDate, formatBytes, formatDuration, parseKey, timeAgo, weekday } from '../lib/date'
import { renderMarkdown } from '../lib/markdown'
import { EASE_OUT, itemIn } from '../lib/motion'
import { toast, usePrefs } from '../lib/store'
import './archive.css'

type Tab = 'review' | 'diary' | 'focus' | 'backup'

interface Overview {
  diary: { entries: number; chars: number; days: number }
  taste: number
  study: { seconds: number; pomodoros: number; sessions: number }
  images: { n: number; bytes: number }
  thisMonth: { entries: number; chars: number }
  moods: { mood: string; n: number }[]
  weathers: { weather: string; n: number }[]
  byMonth: { month: string; entries: number; chars: number }[]
}

function Heatmap() {
  const { data } = useQuery({
    queryKey: ['heatmap'],
    queryFn: () => api.get<{ from: string; to: string; diary: { date: string; chars: number; count: number }[] }>('/api/archive/heatmap?days=371'),
  })
  const [hover, setHover] = useState<{ date: string; chars: number; x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // 窄屏时热力图横向滚动，默认停在最近的几周
  useEffect(() => {
    if (data && box.current) box.current.scrollLeft = box.current.scrollWidth
  }, [data])
  const cells = useMemo(() => {
    if (!data) return []
    const map = new Map(data.diary.map((d) => [d.date, d.chars]))
    // 从「起点所在周的周一」开始排
    const start = parseKey(data.from)
    const lead = (start.getDay() + 6) % 7
    const first = addDays(data.from, -lead)
    const out: { date: string; chars: number; col: number; row: number }[] = []
    for (let i = 0, d = first; d <= data.to; i++, d = addDays(d, 1)) out.push({ date: d, chars: d < data.from ? -1 : map.get(d) || 0, col: Math.floor(i / 7), row: i % 7 })
    return out
  }, [data])
  const months = useMemo(() => {
    const seen = new Set<string>()
    const starts = cells.filter((c) => c.row === 0 && !seen.has(c.date.slice(0, 7)) && seen.add(c.date.slice(0, 7)))
    // 跨年的那个月标上年份；离下一个标签太近的（开头残月）不标，免得叠字
    return starts
      .filter((c, i) => !starts[i + 1] || starts[i + 1].col - c.col >= 3)
      .map((c) => ({ col: c.col, label: c.date.slice(5, 7) === '01' ? `${c.date.slice(0, 4)}年` : `${Number(c.date.slice(5, 7))}月` }))
  }, [cells])
  const level = (n: number) => (n <= 0 ? 0 : n < 200 ? 1 : n < 500 ? 2 : n < 1000 ? 3 : 4)
  const S = 13
  const cols = cells.length ? cells[cells.length - 1].col + 1 : 53
  return (
    <div className="heat" ref={box}>
      <svg viewBox={`0 0 ${cols * S + 4} ${7 * S + 22}`} className="heat-svg" role="img" aria-label="一年来每天写作的字数">
        {months.map((m) => (
          <text key={m.col} x={m.col * S + 2} y={10} className="heat-month">
            {m.label}
          </text>
        ))}
        <g transform="translate(2 18)">
          {cells.map((c, i) =>
            c.chars < 0 ? null : (
              <motion.rect
                key={c.date}
                x={c.col * S}
                y={c.row * S}
                width={S - 3}
                height={S - 3}
                rx={3}
                className={`heat-cell heat-${level(c.chars)}`}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 + c.col * 0.012 + c.row * 0.004, duration: 0.4, ease: EASE_OUT }}
                style={{ transformOrigin: `${c.col * S + 5}px ${c.row * S + 5}px` }}
                onPointerEnter={(e) => {
                  const r = (e.target as SVGRectElement).getBoundingClientRect()
                  setHover({ date: c.date, chars: c.chars, x: r.left + r.width / 2, y: r.top })
                }}
                onPointerLeave={() => setHover((h) => (h?.date === c.date ? null : h))}
                data-i={i}
              />
            ),
          )}
        </g>
      </svg>
      <div className="heat-legend faint">
        少
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-key heat-${l}`} />
        ))}
        多
      </div>
      {/* 提示挂到 body 上：页面里的层叠上下文会把 fixed 定位和 z-index 都关在里面 */}
      {createPortal(
        <AnimatePresence>
          {hover && (
            <motion.div
              key="tip"
              className="heat-tip glass"
              style={{ left: hover.x, top: hover.y }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {cnDate(hover.date, true)}，{hover.chars ? `${hover.chars} 字` : '没写'}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

function Bars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="bars">
      {rows.map((r, i) => (
        <li key={r.label}>
          <span className="bars-label">{r.label}</span>
          <span className="bars-track">
            <motion.span className="bars-fill" initial={{ scaleX: 0 }} animate={{ scaleX: r.value / max }} transition={{ delay: 0.1 + i * 0.05, duration: 0.8, ease: EASE_OUT }} />
          </span>
          <span className="bars-value">
            {r.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Review() {
  const { data: o } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/archive/overview') })
  const { data: stats } = useQuery({ queryKey: ['diary-stats'], queryFn: () => api.get<{ streak: number; longest_streak: number; first_date: string | null }>('/api/diary/stats') })
  const items = [
    { label: '篇日记', value: o?.diary.entries ?? 0 },
    { label: '字', value: o?.diary.chars ?? 0 },
    { label: '天有记录', value: o?.diary.days ?? 0 },
    { label: '天最长连续', value: stats?.longest_streak ?? 0 },
    { label: '件收藏', value: o?.taste ?? 0 },
    { label: '小时专注', value: Math.round((o?.study.seconds ?? 0) / 360) / 10 },
  ]
  return (
    <div className="review">
      <dl className="stats">
        {items.map((s) => (
          <div key={s.label} className="stat">
            <dd>
              <Ticker value={s.value} format={(n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1))} />
            </dd>
            <dt>{s.label}</dt>
          </div>
        ))}
      </dl>
      {stats?.first_date && <p className="review-since faint">从 {cnDate(stats.first_date, true)}写下第一篇算起</p>}
      <section className="glass panel-pad">
        <h2 className="panel-title">一年的书写</h2>
        <Heatmap />
      </section>
      <div className="review-grid">
        <section className="glass panel-pad">
          <h2 className="panel-title">每月字数</h2>
          {o?.byMonth.length ? <Bars rows={o.byMonth.map((m) => ({ label: `${Number(m.month.slice(5))}月`, value: m.chars }))} unit="" /> : <p className="empty">还没有数据</p>}
        </section>
        <section className="glass panel-pad">
          <h2 className="panel-title">心情</h2>
          {o?.moods.length ? <Bars rows={o.moods.map((m) => ({ label: m.mood, value: m.n }))} unit=" 次" /> : <p className="empty">写日记时选一个心情，这里会慢慢长出来</p>}
        </section>
        <section className="glass panel-pad">
          <h2 className="panel-title">天气</h2>
          {o?.weathers.length ? <Bars rows={o.weathers.map((m) => ({ label: m.weather, value: m.n }))} unit=" 天" /> : <p className="empty">还没有记录天气</p>}
        </section>
      </div>
    </div>
  )
}

function EntryReader({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [, go] = useLocation()
  const font = usePrefs((p) => p.editorFont)
  const { data } = useQuery({ queryKey: ['diary-entry', id], queryFn: () => api.get<DiaryEntry>(`/api/diary/entry/${id}`), enabled: !!id })
  return (
    <Sheet open={!!id} onClose={onClose} title={data ? data.title || '无题' : ''} width={760}>
      {data && (
        <>
          <p className="reader-meta" style={{ marginBottom: 20 }}>
            <span>
              {cnDate(data.date_key, true)}，{weekday(data.date_key)}
            </span>
            {data.weather && <span>{data.weather}</span>}
            {data.mood && <span>{data.mood}</span>}
            <span>{data.char_count} 字</span>
          </p>
          <div className={`prose ${font === 'kai' ? 'kai' : ''}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content_md) }} />
          <button className="btn" style={{ marginTop: 26 }} onClick={() => go(`/diary?date=${data.date_key}`)}>
            打开那一天
          </button>
        </>
      )}
    </Sheet>
  )
}

function DiaryList() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const search = useQuery({
    queryKey: ['diary-search', debounced],
    queryFn: () => api.get<{ items: DiaryEntry[] }>(`/api/diary/search?q=${encodeURIComponent(debounced)}`),
    enabled: !!debounced,
  })
  const list = useInfiniteQuery({
    queryKey: ['diary-list'],
    queryFn: ({ pageParam }) => api.get<{ total: number; page: number; size: number; items: DiaryEntry[] }>(`/api/diary/list?page=${pageParam}&size=40`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
  })
  const items = debounced ? search.data?.items || [] : list.data?.pages.flatMap((p) => p.items) || []
  const groups = useMemo(() => {
    const m = new Map<string, DiaryEntry[]>()
    for (const e of items) m.set(e.date_key.slice(0, 7), [...(m.get(e.date_key.slice(0, 7)) || []), e])
    return [...m]
  }, [items])
  const total = list.data?.pages[0]?.total ?? 0
  const highlight = (text: string) => {
    if (!debounced) return text
    const i = text.toLowerCase().indexOf(debounced.toLowerCase())
    if (i < 0) return text
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + debounced.length)}</mark>
        {text.slice(i + debounced.length)}
      </>
    )
  }
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || debounced) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage(), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [list, debounced])

  return (
    <div>
      <label className="t-search a-search">
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`在 ${total} 篇日记里搜索`} aria-label="搜索日记" />
      </label>
      {debounced && search.data && <p className="faint a-count">找到 {items.length} 篇</p>}
      <div className="a-months">
        {groups.map(([month, list]) => (
          <section key={month} className="a-month glass panel-pad">
            <h2 className="a-month-title">
              {month.slice(0, 4)}年{Number(month.slice(5))}月<span className="faint">{list.length} 篇</span>
            </h2>
            <ul className="a-entries">
              {list.map((e, i) => (
                <motion.li key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3), duration: 0.4, ease: EASE_OUT }}>
                  <button className="a-entry" onClick={() => setOpen(e.id)}>
                    <span className="a-entry-date">
                      <b>{Number(e.date_key.slice(8))}</b>
                      <small>{weekday(e.date_key).replace('星期', '周')}</small>
                    </span>
                    <span className="a-entry-body">
                      <span className="a-entry-title">{highlight(e.title || '无题')}</span>
                      <span className="a-entry-ex">{highlight(e.snippet || e.excerpt)}</span>
                    </span>
                    <span className="a-entry-meta faint">
                      {e.mood && <span>{e.mood}</span>}
                      <span>{e.char_count} 字</span>
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!items.length && !list.isLoading && <p className="empty">{debounced ? '没有找到。' : '还没有日记。'}</p>}
      <div ref={sentinel} />
      <EntryReader id={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function Focus() {
  const [days, setDays] = useState<'30' | '90'>('30')
  const { data } = useQuery({ queryKey: ['study-trend', days], queryFn: () => api.get<{ date: string; seconds: number; pomodoros: number }[]>(`/api/study/trend?days=${days}`) })
  const max = Math.max(3600, ...(data || []).map((d) => d.seconds))
  const total = (data || []).reduce((s, d) => s + d.seconds, 0)
  const active = (data || []).filter((d) => d.seconds > 0).length
  return (
    <div>
      <section className="glass panel-pad">
        <div className="panel-title">
          <span>
            近 {days} 天专注 {formatDuration(total)}
            <small className="faint">，{active} 天有专注</small>
          </span>
          <Tabs
            size="sm"
            value={days}
            onChange={setDays}
            options={[
              { value: '30', label: '30 天' },
              { value: '90', label: '90 天' },
            ]}
          />
        </div>
        <div className="trend" role="img" aria-label="每日专注分钟数">
          {data?.map((d, i) => (
            <div key={d.date} className="trend-col" title={`${cnDate(d.date)}：${Math.round(d.seconds / 60)} 分钟`}>
              <motion.span className="trend-bar" initial={{ scaleY: 0 }} animate={{ scaleY: d.seconds / max }} transition={{ delay: i * 0.012, duration: 0.7, ease: EASE_OUT }} />
            </div>
          ))}
        </div>
        <div className="trend-axis faint">
          <span>{data?.[0] && cnDate(data[0].date)}</span>
          <span>今天</span>
        </div>
      </section>
    </div>
  )
}

function Backup() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ dir: string; data_dir: string; music_dir: string; timezone: string; items: { name: string; size: number; created_at: string; auto: boolean }[] }>('/api/backup'),
  })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportReport | null>(null)
  const exp = useMutation({
    mutationFn: (kind: 'export' | 'export-markdown') => api.post<{ name: string; size: number }>(`/api/backup/${kind}`),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['backups'] })
      toast(`已生成 ${r.name}`)
      const a = document.createElement('a')
      a.href = `/api/backup/download/${r.name}`
      a.click()
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const imp = useMutation({
    mutationFn: ({ f, dry }: { f: File; dry: boolean }) => api.post<ImportReport>(`/api/backup/import?dry=${dry ? 1 : 0}&name=${encodeURIComponent(f.name)}`, f, { 'Content-Type': 'application/octet-stream' }),
    onSuccess: (r) => {
      if (r.dry) setPreview(r)
      else {
        setPreview(null)
        setFile(null)
        toast(`导入完成：日记 ${r.diaries.added} 篇，收藏 ${r.taste.added} 条，图片 ${r.images.added} 张`)
        void qc.invalidateQueries()
      }
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const KIND: Record<string, string> = {
    xinghen: '星痕完整备份',
    'legacy-v4': '旧版完整备份',
    'data-dir': '数据库文件',
    'legacy-zip': '旧版备份',
    'legacy-diary-json': '旧站日记 JSON',
    'legacy-mixed-json': '旧站 JSON 备份',
  }
  return (
    <div className="backup">
      <section className="glass panel-pad">
        <h2 className="panel-title">导出</h2>
        <p className="muted">完整备份包含日记、收藏、自习记录、个人资料和所有图片，可以原样导回。每天第一次打开星痕时也会自动备份一份，保留最近 7 份。</p>
        <div className="backup-actions">
          <button className="btn btn--primary" onClick={() => exp.mutate('export')} disabled={exp.isPending}>
            <FileArchive size={16} />
            导出完整备份
          </button>
          <button className="btn" onClick={() => exp.mutate('export-markdown')} disabled={exp.isPending}>
            <FileText size={16} />
            导出日记为 Markdown
          </button>
        </div>
      </section>

      <section className="glass panel-pad">
        <h2 className="panel-title">导入与迁移</h2>
        <p className="muted">可以导入星痕的完整备份（.zip）、旧版的完整备份、单个数据库文件（.db）和旧站的 JSON 备份。导入是合并：已经有的不会重复，也不会覆盖现在的内容。先预览，确认后才写入。</p>
        <label className="drop">
          <Upload size={20} />
          <span>{file ? file.name : '选择备份文件'}</span>
          <input
            type="file"
            accept=".zip,.json,.db"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setFile(f)
              setPreview(null)
              imp.mutate({ f, dry: true })
            }}
          />
        </label>
        <AnimatePresence>
          {preview && file && (
            <motion.div className="preview" {...itemIn}>
              <p>
                识别为 <b>{KIND[preview.kind] || preview.kind}</b>。导入后将：
              </p>
              <ul>
                <li>
                  新增日记 {preview.diaries.added} 篇{preview.diaries.skipped ? `，跳过已有的 ${preview.diaries.skipped} 篇` : ''}
                </li>
                <li>
                  新增收藏 {preview.taste.added} 条{preview.taste.skipped ? `，跳过 ${preview.taste.skipped} 条` : ''}
                </li>
                <li>新增自习记录 {preview.study.added} 条</li>
                <li>
                  写入图片 {preview.images.added + preview.images.inline} 张{preview.images.skipped ? `，已存在 ${preview.images.skipped} 张` : ''}
                </li>
                {preview.profile && <li>导入个人资料</li>}
                {preview.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <div className="backup-actions">
                <button className="btn btn--ghost" onClick={() => (setPreview(null), setFile(null))}>
                  取消
                </button>
                <button className="btn btn--primary" disabled={imp.isPending} onClick={() => imp.mutate({ f: file, dry: false })}>
                  确认导入
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="faint backup-tip">
          换电脑时：在旧电脑上导出完整备份，把 zip 拷过来在这里导入即可；也可以把整个数据文件夹拷过来，用命令 <code>./xinghen import 文件夹路径</code> 导入。
        </p>
      </section>

      <section className="glass panel-pad">
        <h2 className="panel-title">已有备份</h2>
        {data?.items.length ? (
          <ul className="backup-list">
            {data.items.map((b) => (
              <li key={b.name}>
                <span className="backup-name">{b.name}</span>
                <span className="faint">
                  {b.auto ? '自动' : '手动'}，{formatBytes(b.size)}，{timeAgo(b.created_at)}
                </span>
                <a className="icon-btn icon-btn--sm" href={`/api/backup/download/${b.name}`} aria-label={`下载 ${b.name}`}>
                  <Download size={14} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">还没有备份</p>
        )}
        {data && (
          <dl className="paths">
            <dt>数据目录</dt>
            <dd>
              <code>{data.data_dir}</code>
            </dd>
            <dt>备份目录</dt>
            <dd>
              <code>{data.dir}</code>
            </dd>
            <dt>音乐目录</dt>
            <dd>
              <code>{data.music_dir}</code>
            </dd>
            <dt>时区</dt>
            <dd>{data.timezone}</dd>
          </dl>
        )}
      </section>
    </div>
  )
}

export default function Archive() {
  const search = useSearch()
  const [, go] = useLocation()
  const tab = (new URLSearchParams(search).get('tab') as Tab) || 'review'
  return (
    <div className="page archive">
      <header className="page-head">
        <div>
          <h1 className="page-title">档案室</h1>
          <p className="page-sub">回看写过的、专注过的，以及把它们安全地存好</p>
        </div>
        <Tabs
          value={tab}
          onChange={(t) => go(t === 'review' ? '/archive' : `/archive?tab=${t}`, { replace: true })}
          label="档案室栏目"
          options={[
            { value: 'review', label: '回顾' },
            { value: 'diary', label: '日记' },
            { value: 'focus', label: '专注' },
            { value: 'backup', label: '备份' },
          ]}
        />
      </header>
      {/* 按栏目重新挂载，面板各自淡入；外层不做透明度动画，毛玻璃才不会失效 */}
      <div key={tab}>
        {tab === 'review' && <Review />}
        {tab === 'diary' && <DiaryList />}
        {tab === 'focus' && <Focus />}
        {tab === 'backup' && <Backup />}
      </div>
    </div>
  )
}
