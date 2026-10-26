// Ctrl K：在一个框里找日记、收藏和栏目。上下键选择，回车打开。
import { AnimatePresence, motion } from 'motion/react'
import { BookOpen, CornerDownLeft, Search, Sparkle, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { api, type DiaryEntry, type TasteItem } from '../lib/api'
import { cnDate } from '../lib/date'
import { SPRING_LAYOUT, SPRING_PANEL } from '../lib/motion'
import { ROUTES } from '../routes'
import './palette.css'

interface Hit {
  id: string
  kind: 'page' | 'diary' | 'taste'
  title: string
  sub: string
  go: string
}

export default function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, go] = useLocation()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 160)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30)
  }, [open])
  const diary = useQuery({ queryKey: ['diary-search', debounced], queryFn: () => api.get<{ items: DiaryEntry[] }>(`/api/diary/search?q=${encodeURIComponent(debounced)}`), enabled: !!debounced })
  const taste = useQuery({ queryKey: ['taste', `q=${debounced}`], queryFn: () => api.get<TasteItem[]>(`/api/taste?q=${encodeURIComponent(debounced)}`), enabled: !!debounced })

  const hits = useMemo<Hit[]>(() => {
    const pages: Hit[] = ROUTES.filter((r) => !debounced || r.label.includes(debounced) || r.title.includes(debounced)).map((r) => ({ id: r.path, kind: 'page', title: r.title.split(' · ')[0], sub: '栏目', go: r.path }))
    const d: Hit[] = (diary.data?.items || []).slice(0, 8).map((e) => ({ id: `d${e.id}`, kind: 'diary', title: e.title || '无题', sub: `${cnDate(e.date_key, true)}  ${e.snippet || e.excerpt}`, go: `/diary?date=${e.date_key}&entry=${e.id}` }))
    const t: Hit[] = (taste.data || []).slice(0, 6).map((i) => ({ id: `t${i.id}`, kind: 'taste', title: i.title || i.note.slice(0, 30), sub: i.subtitle || i.category || '收藏', go: '/taste' }))
    return debounced ? [...d, ...t, ...pages] : pages
  }, [debounced, diary.data, taste.data])

  useEffect(() => setSel(0), [debounced])
  const pick = (h: Hit) => {
    go(h.go)
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="pal-root" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
          <motion.div className="sheet-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div className="pal glass" role="dialog" aria-label="搜索" initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={SPRING_PANEL}>
            <label className="pal-input">
              <Search size={18} />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索日记、收藏，或跳到某个栏目"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSel((s) => Math.min(hits.length - 1, s + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSel((s) => Math.max(0, s - 1))
                  } else if (e.key === 'Enter' && hits[sel]) pick(hits[sel])
                }}
              />
              <kbd>Esc</kbd>
            </label>
            <ul className="pal-list" role="listbox">
              {hits.map((h, i) => (
                <li key={h.id} role="option" aria-selected={i === sel}>
                  <button className="pal-item" onMouseMove={() => setSel(i)} onClick={() => pick(h)}>
                    {i === sel && <motion.span layoutId="pal-sel" className="pal-sel" transition={SPRING_LAYOUT} />}
                    <span className="pal-icon">{h.kind === 'diary' ? <BookOpen size={15} /> : h.kind === 'taste' ? <Star size={15} /> : <Sparkle size={15} />}</span>
                    <span className="pal-text">
                      <span className="pal-title">{h.title}</span>
                      <span className="pal-sub">{h.sub}</span>
                    </span>
                    {i === sel && <CornerDownLeft size={14} className="pal-enter" />}
                  </button>
                </li>
              ))}
              {debounced && !hits.length && !diary.isFetching && <li className="empty">没有找到「{debounced}」</li>}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
