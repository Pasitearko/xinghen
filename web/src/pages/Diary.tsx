import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { Calendar } from '../components/Calendar'
import { TagInput } from '../components/TagInput'
import { Confirm, Ticker } from '../components/ui'
import { api, type DiaryDay, type DiaryEntry } from '../lib/api'
import { clock, cnDate, dateKey, lunar, parseKey, timeAgo, weekday } from '../lib/date'
import { renderMarkdown } from '../lib/markdown'
import { EASE_OUT, itemIn, SPRING_LAYOUT } from '../lib/motion'
import { meteor, toast, usePrefs } from '../lib/store'
import { Editor, type EditorHandle } from './diary/Editor'
import { Inspiration } from './diary/Inspiration'
import { useEntryEditor, type SaveState } from './diary/useEntryEditor'
import './diary.css'

const WEATHERS = ['晴', '多云', '阴', '小雨', '大雨', '雪', '雾', '风']
const MOODS = ['平静', '愉快', '充实', '期待', '疲惫', '低落', '焦虑', '烦躁']

function ChipPicker({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const custom = value && !options.includes(value)
  const [editing, setEditing] = useState(false)
  return (
    <div className="picker" role="group" aria-label={label}>
      <span className="picker-label">{label}</span>
      <div className="picker-chips">
        {options.map((o) => (
          <button key={o} className={`chip ${value === o ? 'chip--on' : ''}`} onClick={() => onChange(value === o ? '' : o)} aria-pressed={value === o}>
            {o}
          </button>
        ))}
        {editing || custom ? (
          <input
            className="chip chip-input"
            defaultValue={custom ? value : ''}
            autoFocus={editing}
            maxLength={12}
            placeholder="写一个"
            onBlur={(e) => {
              setEditing(false)
              onChange(e.target.value.trim())
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className="chip" onClick={() => setEditing(true)}>
            其他
          </button>
        )}
      </div>
    </div>
  )
}

function SaveBadge({ state, savedAt }: { state: SaveState; savedAt: string | null }) {
  const text: Record<SaveState, string> = {
    idle: '没写字前不会保存',
    dirty: '正在记下…',
    saving: '保存中…',
    saved: savedAt ? `已保存 ${clock(savedAt)}` : '已保存',
    error: '保存失败，内容留在本机，稍后自动重试',
    conflict: '另一个窗口改过这篇',
  }
  return (
    <span className={`save save--${state}`} role="status">
      <span className="save-dot" />
      {text[state]}
    </span>
  )
}

/** 封存的一天：整天的篇目连起来读，像翻一页旧信。 */
function Reader({ day }: { day: DiaryDay }) {
  const font = usePrefs((p) => p.editorFont)
  if (!day.entries.length) {
    return (
      <div className="paper glass reader-empty">
        <p className="empty">这一天没有留下日记。</p>
      </div>
    )
  }
  return (
    <div className="reader">
      {day.entries.map((e, i) => (
        <motion.article
          key={e.id}
          className="paper glass"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.6, ease: EASE_OUT }}
        >
          {i === 0 && (
            <div className="seal" aria-label="本日已封存，只能阅读">
              <span>封存</span>
            </div>
          )}
          <header className="reader-head">
            <h2 className="reader-title">{e.title || '无题'}</h2>
            <p className="reader-meta">
              {[e.weather, e.mood, `${e.char_count} 字`, `写于 ${clock(e.created_at)}`].filter(Boolean).map((m) => (
                <span key={m}>{m}</span>
              ))}
              {e.tags.map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
            </p>
          </header>
          <div className={`prose ${font === 'kai' ? 'kai' : ''}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(e.content_md) }} />
        </motion.article>
      ))}
    </div>
  )
}

function Composer({ day, startWith }: { day: DiaryDay; startWith: number | 'new' | null }) {
  const font = usePrefs((p) => p.editorFont)
  const qc = useQueryClient()
  const ed = useEntryEditor(day.date)
  const [confirm, setConfirm] = useState(false)
  const loaded = useRef<string | null>(null)

  // 每次进入这一天只自动打开一次（默认打开最后一篇），之后的列表刷新不打断正在写的内容
  useEffect(() => {
    if (loaded.current === day.date) return
    loaded.current = day.date
    const want = startWith === 'new' ? null : day.entries.find((e) => e.id === startWith) || day.entries[day.entries.length - 1] || null
    void ed.load(want)
  }, [day, startWith, ed])

  const current = ed.entryId
  const pick = (e: DiaryEntry | null) => void ed.load(e)
  const saveNow = async () => {
    if (!ed.form.title.trim() && !ed.form.content_md.trim()) {
      toast('先写点什么再保存', 'info')
      return
    }
    if (ed.state === 'saved') {
      meteor()
      return
    }
    if (await ed.flush()) {
      meteor()
      toast('已保存')
    }
  }
  const remove = async () => {
    if (!current) {
      void ed.load(null)
      return
    }
    await api.del(`/api/diary/${current}`)
    await qc.invalidateQueries({ queryKey: ['diary-day', day.date] })
    void qc.invalidateQueries({ queryKey: ['diary-dates'] })
    void qc.invalidateQueries({ queryKey: ['diary-stats'] })
    toast('已删除这篇日记')
    const rest = day.entries.filter((e) => e.id !== current)
    void ed.load(rest[rest.length - 1] || null)
  }

  // 把问题作为一行引用接在正文末尾，光标停在它下面，直接开始答
  const editor = useRef<EditorHandle>(null)
  const writeQuestion = (q: string) => editor.current?.appendBlock(`> ${q}`)

  const words = useMemo(() => ed.form.content_md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*_`~\-\s]/g, '').length, [ed.form.content_md])
  const isDraft = !current
  const nth = isDraft ? day.entries.length + 1 : (day.entries.find((e) => e.id === current)?.entry_index ?? 1)

  return (
    <div className="diary-body diary-desk">
      <aside className="diary-side">
        <section className="glass panel-pad">
          <div className="panel-title">
            <span>今天的篇目</span>
            <button className="icon-btn icon-btn--sm" onClick={() => pick(null)} aria-label="新的一篇" title="新的一篇">
              <Plus size={16} />
            </button>
          </div>
          <ul className="entries">
            {day.entries.map((e) => (
              <li key={e.id}>
                <button className={`entry ${e.id === current ? 'entry--on' : ''}`} onClick={() => e.id !== current && pick(e)}>
                  {e.id === current && <motion.span layoutId="entry-on" className="entry-bg" transition={SPRING_LAYOUT} />}
                  <span className="entry-idx">{e.entry_index}</span>
                  <span className="entry-body">
                    <span className="entry-title">{e.id === current ? ed.form.title || '无题' : e.title || '无题'}</span>
                    <span className="entry-meta">
                      {e.id === current ? words : e.char_count} 字，{timeAgo(e.updated_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {isDraft && (
              <li>
                <div className="entry entry--on entry--draft">
                  <motion.span layoutId="entry-on" className="entry-bg" transition={SPRING_LAYOUT} />
                  <span className="entry-idx">＋</span>
                  <span className="entry-body">
                    <span className="entry-title">{ed.form.title || '新的一篇'}</span>
                    <span className="entry-meta">还没保存，写下文字后自动保存</span>
                  </span>
                </div>
              </li>
            )}
          </ul>
        </section>
        <Inspiration onUse={writeQuestion} />
      </aside>

      <section className="paper glass composer">
        {ed.conflict && (
          <motion.div className="conflict" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <p>
              这篇日记在另一个窗口里改过（{clock(ed.conflict.updated_at)}）。自动保存已暂停，你手上的内容还在。
            </p>
            <div className="conflict-actions">
              <button className="btn btn--sm" onClick={() => void ed.resolve('theirs')}>
                用那边的版本
              </button>
              <button className="btn btn--sm btn--primary" onClick={() => void ed.resolve('mine')}>
                用我这份覆盖
              </button>
            </div>
          </motion.div>
        )}
        <input
          className="composer-title"
          value={ed.form.title}
          placeholder="标题"
          maxLength={120}
          onChange={(e) => ed.update({ title: e.target.value })}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault()
              void saveNow()
            }
          }}
        />
        <Editor ref={editor} value={ed.form.content_md} onChange={(v) => ed.update({ content_md: v })} font={font} onSave={() => void saveNow()} />
        <footer className="composer-foot">
          <SaveBadge state={ed.state} savedAt={ed.savedAt} />
          <span className="editor-spacer" />
          <button className="btn btn--ghost btn--danger btn--sm" onClick={() => (current ? setConfirm(true) : remove())} disabled={isDraft && !ed.form.content_md && !ed.form.title}>
            <Trash2 size={14} />
            {current ? '删除' : '放弃'}
          </button>
          <button className="btn btn--sm btn--primary" onClick={() => void saveNow()} title="Ctrl S">
            保存
          </button>
        </footer>
      </section>

      {/* 页边：天气、心情、标签与字数，从信纸里挪出来，信纸上只留标题和正文 */}
      <aside className="glass panel-pad diary-margin">
        <div className="margin-count">
          <Ticker value={words} />
          <small>字</small>
        </div>
        <p className="margin-hint">{nth === 1 ? '今天的第一篇' : `今天第 ${nth} 篇`}</p>
        <div className="margin-pickers">
          <ChipPicker label="天气" options={WEATHERS} value={ed.form.weather} onChange={(v) => ed.update({ weather: v })} />
          <ChipPicker label="心情" options={MOODS} value={ed.form.mood} onChange={(v) => ed.update({ mood: v })} />
          <TagInput tags={ed.form.tags} onChange={(tags) => ed.update({ tags })} />
        </div>
        <p className="margin-hint faint">Ctrl S 保存，停笔一会儿也会自动保存。</p>
      </aside>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="删除这篇日记？"
        body="删除后不能恢复（自动备份里仍有删除前的版本）。"
        confirmText="删除"
        danger
        onConfirm={() => void remove()}
      />
    </div>
  )
}

/** 封存那天的页边：这一天写了什么样的日子 */
function DaySummary({ day }: { day: DiaryDay }) {
  if (!day.entries.length) return null
  const chars = day.entries.reduce((n, e) => n + e.char_count, 0)
  const pick = (k: 'weather' | 'mood') => [...new Set(day.entries.map((e) => e[k]).filter(Boolean))]
  const tags = [...new Set(day.entries.flatMap((e) => e.tags))]
  const rows: [string, string[]][] = [
    ['天气', pick('weather')],
    ['心情', pick('mood')],
  ]
  return (
    <aside className="glass panel-pad diary-margin">
      <div className="margin-count">
        <Ticker value={chars} />
        <small>字</small>
      </div>
      <p className="margin-hint">{day.entries.length} 篇，写于{weekday(day.date)}</p>
      <dl className="margin-facts">
        {rows.map(([k, v]) =>
          v.length ? (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v.join('，')}</dd>
            </div>
          ) : null,
        )}
        {tags.length > 0 && (
          <div>
            <dt>标签</dt>
            <dd>
              {tags.map((t) => (
                <span key={t} className="tag">
                  #{t}{' '}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </aside>
  )
}

function DayCalendar({ date, today }: { date: string; today: string }) {
  const [, go] = useLocation()
  return (
    <section className="glass panel-pad">
      <Calendar selected={date} today={today} onPick={(d) => go(d === today ? '/diary' : `/diary?date=${d}`)} />
    </section>
  )
}

export default function Diary() {
  const search = useSearch()
  const [, go] = useLocation()
  const params = new URLSearchParams(search)
  const date = params.get('date') || 'today'
  const startWith = params.get('entry') === 'new' ? 'new' : params.get('entry') ? Number(params.get('entry')) : null
  const { data: day, isLoading, error } = useQuery({
    queryKey: ['diary-day', date === 'today' ? dateKey() : date],
    queryFn: () => api.get<DiaryDay>(`/api/diary/day/${date}`),
  })
  const toDay = useCallback((d: string | null) => d && go(day && d === day.today ? '/diary' : `/diary?date=${d}`), [go, day])

  if (error) return <div className="page"><p className="empty">{(error as Error).message}</p></div>
  const key = day?.date || ''
  const lu = key ? lunar(parseKey(key)) : null
  return (
    <div className="page diary">
      <header className="page-head diary-head">
        <div className="diary-date">
          <button className="icon-btn" disabled={!day?.prev} onClick={() => toDay(day!.prev)} aria-label="上一个写过日记的日子" title="上一个写过的日子">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">{key ? (key === day!.today ? '今天' : cnDate(key)) : ' '}</h1>
            <p className="page-sub">
              {key && (
                <>
                  {cnDate(key, true)}，{weekday(key)}
                  {lu && <span className="nowrap">，农历{lu.month}{lu.day}</span>}
                  {day && !day.editable && '。这一天已经封存，只能阅读'}
                </>
              )}
            </p>
          </div>
          <button className="icon-btn" disabled={!day?.next} onClick={() => toDay(day!.next)} aria-label="下一个写过日记的日子" title="下一个写过的日子">
            <ChevronRight size={20} />
          </button>
        </div>
        {day && !day.editable && (
          <button className="btn" onClick={() => go('/diary')}>
            回到今天
          </button>
        )}
      </header>
      <AnimatePresence mode="wait">
        {isLoading || !day ? (
          <motion.div key="loading" className="diary-body" {...itemIn}>
            <div className="skeleton" style={{ height: 220 }} />
            <div className="skeleton" style={{ height: 520 }} />
          </motion.div>
        ) : (
          // 不在这里做透明度动画：里面的面板各自淡入，祖先带 opacity 会让毛玻璃失效
          <div key={day.date}>
            {day.editable ? (
              <Composer day={day} startWith={startWith} />
            ) : (
              <div className="diary-body diary-desk">
                <aside className="diary-side">
                  <DayCalendar date={day.date} today={day.today} />
                </aside>
                <Reader day={day} />
                <DaySummary day={day} />
              </div>
            )}
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
