// 月历：写过日记的日子落一颗星，字数越多星越亮；节气与农历写在日期下面。
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type DateSummary } from '../lib/api'
import { dateKey, lunar, solarTerm, WEEK_SHORT } from '../lib/date'
import { EASE_OUT } from '../lib/motion'
import './calendar.css'

const pad = (n: number) => String(n).padStart(2, '0')

export function Calendar({ selected, onPick, today }: { selected?: string; onPick: (key: string) => void; today: string }) {
  const [cursor, setCursor] = useState(() => {
    const [y, m] = (selected || today).split('-').map(Number)
    return { y, m }
  })
  const [dir, setDir] = useState(0)
  const first = `${cursor.y}-${pad(cursor.m)}-01`
  const lastDay = new Date(cursor.y, cursor.m, 0).getDate()
  const last = `${cursor.y}-${pad(cursor.m)}-${pad(lastDay)}`
  const { data } = useQuery({
    queryKey: ['diary-dates', first],
    queryFn: () => api.get<DateSummary[]>(`/api/diary/dates?from=${first}&to=${last}`),
  })
  const byDate = useMemo(() => new Map((data || []).map((d) => [d.date, d])), [data])

  const cells = useMemo(() => {
    const lead = (new Date(cursor.y, cursor.m - 1, 1).getDay() + 6) % 7 // 周一开头
    const out: ({ key: string; day: number; sub: string; term: boolean } | null)[] = Array(lead).fill(null)
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(cursor.y, cursor.m - 1, d)
      const term = solarTerm(date)
      const lu = lunar(date)
      out.push({ key: dateKey(date), day: d, sub: term || (lu ? (lu.day === '初一' ? lu.month : lu.day) : ''), term: !!term })
    }
    return out
  }, [cursor, lastDay])

  const move = (n: number) => {
    setDir(n)
    setCursor((c) => {
      const d = new Date(c.y, c.m - 1 + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() + 1 }
    })
  }
  const isThisMonth = today.startsWith(`${cursor.y}-${pad(cursor.m)}`)

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="icon-btn icon-btn--sm" onClick={() => move(-1)} aria-label="上个月">
          <ChevronLeft size={16} />
        </button>
        <button
          className="cal-month"
          onClick={() => {
            const [y, m] = today.split('-').map(Number)
            setDir(0)
            setCursor({ y, m })
          }}
          title={isThisMonth ? undefined : '回到本月'}
        >
          {cursor.y}年{cursor.m}月
        </button>
        <button className="icon-btn icon-btn--sm" onClick={() => move(1)} aria-label="下个月">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="cal-week">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => (
          <span key={w}>{WEEK_SHORT[w]}</span>
        ))}
      </div>
      <div className="cal-viewport">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={first}
            className="cal-grid"
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d * 36, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d * -36, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.45, ease: EASE_OUT }}
          >
            {cells.map((c, i) => {
              if (!c) return <span key={`e${i}`} />
              const info = byDate.get(c.key)
              const future = c.key > today
              const glow = info ? Math.min(1, 0.35 + info.chars / 1500) : 0
              return (
                <button
                  key={c.key}
                  className={`cal-day ${c.key === today ? 'cal-day--today' : ''} ${c.key === selected ? 'cal-day--sel' : ''} ${info ? 'cal-day--has' : ''}`}
                  disabled={future}
                  onClick={() => onPick(c.key)}
                  title={info ? `${info.count} 篇 · ${info.chars} 字` : undefined}
                >
                  <span className="cal-num">{c.day}</span>
                  <span className={`cal-sub ${c.term ? 'cal-sub--term' : ''}`}>{c.sub}</span>
                  {info && <span className="cal-star" style={{ opacity: glow, transform: `scale(${0.7 + glow * 0.5})` }} />}
                </button>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
