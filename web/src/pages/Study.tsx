import { AnimatePresence, motion } from 'motion/react'
import { Play, Plus, Square, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Tabs, Ticker } from '../components/ui'
import { api, type ScheduleItem, type StudySession, type StudyToday, type Todo } from '../lib/api'
import { clock, formatDuration } from '../lib/date'
import { EASE_OUT, itemIn, SPRING_LAYOUT } from '../lib/motion'
import { toast, useStore } from '../lib/store'
import { ensureTicker, finishFocus, onTimerChange, remaining, skipBreak, startFocus, timer } from '../lib/timer'
import './study.css'

const PRESETS = [25, 45, 60, 90]

/** 计时中每 250ms 看一眼剩余时间，但只在显示的秒数变了才重渲染（每秒一次） */
function useSecondTick(active: boolean, read: () => number) {
  const [, setSec] = useState(0)
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setSec(Math.ceil(readRef.current() / 1000)), 250)
    return () => clearInterval(id)
  }, [active])
}

function mmss(ms: number) {
  const s = Math.ceil(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 刻度：60 格，像一圈星。固定不变，只算一次 */
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * Math.PI * 2 - Math.PI / 2
  const r1 = 146
  const r2 = i % 5 === 0 ? 141 : 143.5
  return <line key={i} x1={150 + Math.cos(a) * r1} y1={150 + Math.sin(a) * r1} x2={150 + Math.cos(a) * r2} y2={150 + Math.sin(a) * r2} className="ring-tick" />
})

function Ring({ progress, tone }: { progress: number; tone: 'focus' | 'break' | 'idle' }) {
  const R = 132
  const C = 2 * Math.PI * R
  return (
    <svg viewBox="0 0 300 300" className={`ring ring--${tone}`} aria-hidden>
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--ring-a)" />
          <stop offset="1" stopColor="var(--ring-b)" />
        </linearGradient>
      </defs>
      {TICKS}
      <circle cx="150" cy="150" r={R} className="ring-track" />
      <motion.circle
        cx="150"
        cy="150"
        r={R}
        className="ring-bar"
        strokeDasharray={C}
        initial={false}
        animate={{ strokeDashoffset: C * (1 - progress) }}
        transition={{ duration: 0.6, ease: 'linear' }}
        transform="rotate(-90 150 150)"
      />
    </svg>
  )
}

function Timer({ todos }: { todos: Todo[] }) {
  const session = useStore(timer, (s) => s.session)
  const breakUntil = useStore(timer, (s) => s.breakUntil)
  const [minutes, setMinutes] = useState(25)
  const [custom, setCustom] = useState(false)
  const [todoId, setTodoId] = useState<number | null>(null)
  useSecondTick(!!session || !!breakUntil, () => (session ? remaining() : Math.max(0, (breakUntil || 0) - Date.now())))
  const open = todos.filter((t) => !t.is_completed)
  const bound = session ? todos.find((t) => t.id === session.todo_id) : todos.find((t) => t.id === todoId)

  useEffect(() => {
    if (todoId && !open.some((t) => t.id === todoId)) setTodoId(null)
  }, [open, todoId])

  let label = mmss(minutes * 60_000)
  let progress = 0
  let tone: 'focus' | 'break' | 'idle' = 'idle'
  if (session) {
    const left = remaining()
    label = mmss(left)
    progress = 1 - left / (session.planned_minutes * 60_000)
    tone = 'focus'
  } else if (breakUntil) {
    const left = Math.max(0, breakUntil - Date.now())
    label = mmss(left)
    progress = 1 - left / (timer.get().breakMinutes * 60_000)
    tone = 'break'
  }

  return (
    <section className="glass timer">
      <div className="timer-face">
        <Ring progress={progress} tone={tone} />
        <div className="timer-center">
          <span className="timer-mode">{tone === 'focus' ? '专注中' : tone === 'break' ? '休息一下' : '准备开始'}</span>
          <span className="timer-time" aria-live="off">
            {label}
          </span>
          <AnimatePresence mode="wait">
            <motion.span key={bound?.id ?? 'none'} className="timer-task" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {bound ? bound.title : tone === 'focus' ? '自由专注' : ' '}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {session ? (
          <motion.div key="run" className="timer-actions" {...itemIn}>
            <button className="btn" onClick={() => void finishFocus('finished')}>
              <Square size={14} />
              提前结束并记录
            </button>
            <button className="btn btn--ghost btn--danger" onClick={() => void finishFocus('abandoned')}>
              放弃
            </button>
          </motion.div>
        ) : breakUntil ? (
          <motion.div key="break" className="timer-actions" {...itemIn}>
            <button className="btn" onClick={skipBreak}>
              跳过休息
            </button>
          </motion.div>
        ) : (
          <motion.div key="idle" className="timer-setup" {...itemIn}>
            <div className="timer-presets">
              <Tabs
                value={custom ? 'custom' : String(minutes)}
                onChange={(v) => {
                  if (v === 'custom') setCustom(true)
                  else {
                    setCustom(false)
                    setMinutes(Number(v))
                  }
                }}
                label="时长"
                options={[...PRESETS.map((m) => ({ value: String(m), label: `${m} 分` })), { value: 'custom', label: '自定' }]}
              />
              {custom && (
                <input className="field timer-custom" type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} aria-label="自定义分钟数" />
              )}
            </div>
            {open.length > 0 && (
              <div className="timer-todos">
                {open.slice(0, 8).map((t) => (
                  <button key={t.id} className={`chip ${todoId === t.id ? 'chip--on' : ''}`} onClick={() => setTodoId(todoId === t.id ? null : t.id)}>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn--primary timer-start" onClick={() => void startFocus(minutes, todoId, bound?.break_minutes ?? 5)}>
              <Play size={15} />
              开始专注
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function Todos({ todos }: { todos: Todo[] }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const set = (list: Todo[]) => qc.setQueryData<StudyToday>(['study-today'], (d) => (d ? { ...d, todos: list } : d))
  const add = useMutation({ mutationFn: () => api.post<Todo[]>('/api/study/todos', { title }), onSuccess: (l) => (set(l), setTitle('')), onError: (e: Error) => toast(e.message, 'error') })
  const patch = useMutation({ mutationFn: ({ id, ...b }: Partial<Todo> & { id: number }) => api.patch<Todo[]>(`/api/study/todos/${id}`, b), onSuccess: set })
  const del = useMutation({ mutationFn: (id: number) => api.del<Todo[]>(`/api/study/todos/${id}`), onSuccess: set })
  return (
    <section className="glass panel-pad study-todos">
      <h2 className="panel-title">待办</h2>
      <form
        className="s-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) add.mutate()
        }}
      >
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="接下来要做的事" />
        <button className="icon-btn" aria-label="添加待办" disabled={!title.trim()}>
          <Plus size={18} />
        </button>
      </form>
      <ul className="s-list">
        <AnimatePresence initial={false}>
          {todos.map((t) => (
            <motion.li key={t.id} layout className="s-row" {...itemIn} transition={SPRING_LAYOUT}>
              <Check
                checked={t.is_completed}
                onChange={(v) => patch.mutate({ id: t.id, is_completed: v })}
                label={t.title}
                sub={t.completed_pomodoros > 0 ? <span className="s-dots">{'●'.repeat(Math.min(t.completed_pomodoros, 12))} {t.completed_pomodoros} 个番茄</span> : undefined}
              />
              <button className="icon-btn icon-btn--sm s-del" onClick={() => del.mutate(t.id)} aria-label={`删除 ${t.title}`}>
                <Trash2 size={14} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {!todos.length && <p className="empty">还没有待办。写下一件事，专注时可以绑定它。</p>}
    </section>
  )
}

function Schedule({ items }: { items: ScheduleItem[] }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ title: '', start_time: '', end_time: '' })
  const set = (list: ScheduleItem[]) => qc.setQueryData<StudyToday>(['study-today'], (d) => (d ? { ...d, schedule: list } : d))
  const add = useMutation({
    mutationFn: () => api.post<ScheduleItem[]>('/api/study/schedule', form),
    onSuccess: (l) => (set(l), setForm({ title: '', start_time: form.end_time, end_time: '' })),
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const patch = useMutation({ mutationFn: ({ id, ...b }: Partial<ScheduleItem> & { id: number }) => api.patch<ScheduleItem[]>(`/api/study/schedule/${id}`, b), onSuccess: set })
  const del = useMutation({ mutationFn: (id: number) => api.del<ScheduleItem[]>(`/api/study/schedule/${id}`), onSuccess: set })
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return (
    <section className="glass panel-pad study-sched">
      <h2 className="panel-title">今日日程</h2>
      <form
        className="s-add s-add--sched"
        onSubmit={(e) => {
          e.preventDefault()
          if (form.title.trim()) add.mutate()
        }}
      >
        <input className="field" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} aria-label="开始时间" />
        <input className="field" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} aria-label="结束时间" />
        <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="安排什么" />
        <button className="icon-btn" aria-label="添加日程" disabled={!form.title.trim()}>
          <Plus size={18} />
        </button>
      </form>
      <ol className="s-timeline">
        <AnimatePresence initial={false}>
          {items.map((s) => {
            const nowIn = s.start_time && s.start_time <= hhmm && (!s.end_time || hhmm < s.end_time)
            return (
              <motion.li key={s.id} layout className={`s-slot ${nowIn ? 's-slot--now' : ''}`} {...itemIn} transition={SPRING_LAYOUT}>
                <span className="s-time">
                  {s.start_time || '全天'}
                  {s.end_time && <small>{s.end_time}</small>}
                </span>
                <Check checked={s.is_completed} onChange={(v) => patch.mutate({ id: s.id, is_completed: v })} label={s.title} />
                <button className="icon-btn icon-btn--sm s-del" onClick={() => del.mutate(s.id)} aria-label={`删除 ${s.title}`}>
                  <X size={14} />
                </button>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ol>
      {!items.length && <p className="empty">今天还没有安排。</p>}
    </section>
  )
}

/** 一天的时间轴：每次专注是轴上的一段，番茄是金色的，竖线是此刻 */
function DayLine({ sessions }: { sessions: StudySession[] }) {
  const now = new Date()
  const first = sessions.length ? Math.min(...sessions.map((s) => new Date(s.started_at).getHours())) : 6
  // 默认从早上 6 点画起；有更早的专注、或者现在就是凌晨，就从那个整点画起
  const from = Math.min(6, first, now.getHours())
  const span = (24 - from) * 60
  const at = (d: Date) => (((d.getHours() - from) * 60 + d.getMinutes() + d.getSeconds() / 60) / span) * 100
  const ticks = Array.from({ length: Math.floor((24 - from) / 2) + 1 }, (_, i) => from + i * 2)
  return (
    <div className="dayline" role="img" aria-label={`今天专注了 ${sessions.length} 次`}>
      <div className="dayline-track" style={{ ['--hours' as string]: 24 - from }}>
        {sessions.map((s, i) => (
          <motion.span
            key={s.id}
            className={`dayline-block ${s.pomodoros ? 'is-tomato' : ''}`}
            style={{ left: `${at(new Date(s.started_at))}%`, width: `max(4px, ${(s.focused_seconds / 60 / span) * 100}%)` }}
            title={`${clock(s.started_at)} ${s.todo_title || '自由专注'}，${formatDuration(s.focused_seconds)}`}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.2 + i * 0.05, duration: 0.6, ease: EASE_OUT }}
          />
        ))}
        <span className="dayline-now" style={{ left: `${Math.min(100, Math.max(0, at(now)))}%` }} />
      </div>
      <div className="dayline-ticks">
        {ticks.map((h) => (
          <span key={h} style={{ left: `${((h - from) * 60 * 100) / span}%` }}>
            {h}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Study() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['study-today'], queryFn: () => api.get<StudyToday>('/api/study/today'), refetchInterval: 60_000 })
  useEffect(() => {
    ensureTicker()
    onTimerChange(() => {
      void qc.invalidateQueries({ queryKey: ['study-today'] })
      void qc.invalidateQueries({ queryKey: ['study-trend'] })
    })
  }, [qc])
  const sessions = data?.sessions || []
  const minutes = Math.round((data?.stats.seconds || 0) / 60)
  const sorted = useMemo(() => [...(data?.todos || [])].sort((a, b) => Number(a.is_completed) - Number(b.is_completed)), [data])

  return (
    <div className="page study">
      <header className="page-head">
        <div>
          <h1 className="page-title">自习室</h1>
          <p className="page-sub">
            今天专注了 <Ticker value={minutes} className="s-big" /> 分钟，完成 <Ticker value={data?.stats.pomodoros || 0} className="s-big" /> 个番茄
          </p>
        </div>
      </header>
      <div className="study-grid">
        <Timer todos={data?.todos || []} />
        <Todos todos={sorted} />
        <Schedule items={data?.schedule || []} />
        <section className="glass panel-pad study-log">
          <h2 className="panel-title">今天的专注记录</h2>
          <DayLine sessions={sessions} />
          {sessions.length ? (
            <ul className="s-sessions">
              {sessions.map((s, i) => (
                <motion.li key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04, ease: EASE_OUT }}>
                  <span className="s-time">{clock(s.started_at)}</span>
                  <span className="s-sess-title">{s.todo_title || '自由专注'}</span>
                  <span className="faint">{formatDuration(s.focused_seconds)}</span>
                  {s.pomodoros > 0 && <span className="s-tomato" title="完整的番茄" />}
                </motion.li>
              ))}
            </ul>
          ) : (
            <p className="empty">完成一次专注后，这里会留下记录。</p>
          )}
        </section>
      </div>
    </div>
  )
}
