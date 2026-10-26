// 一篇日记的编辑状态与自动保存。
// - 草稿没写字就不落库；写下第一个字 1.2 秒后才创建；
// - 每次保存带 version，另一个窗口改过就进入「冲突」，绝不静默覆盖；
// - 每次改动同时写进 localStorage，服务挂了或断电也不丢字；
// - 关页面前用 keepalive 请求把最后一点改动送出去。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type DiaryEntry } from '../../lib/api'

export interface Form {
  title: string
  content_md: string
  weather: string
  mood: string
  tags: string[]
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

const EMPTY: Form = { title: '', content_md: '', weather: '', mood: '', tags: [] }
const DRAFT_KEY = (identity: string) => `feixing.draft.${identity}`

const uuid = (): string => crypto.randomUUID()

function fromEntry(e: DiaryEntry): Form {
  return { title: e.title, content_md: e.content_md, weather: e.weather, mood: e.mood, tags: e.tags }
}

function hasContent(f: Form) {
  return !!(f.title.trim() || f.content_md.trim())
}

export function useEntryEditor(date: string, onSaved?: (e: DiaryEntry) => void) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Form>(EMPTY)
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [entryId, setEntryId] = useState<number | null>(null)
  const [conflict, setConflict] = useState<DiaryEntry | null>(null)
  const ref = useRef({ form: EMPTY, id: null as number | null, identity: uuid() as string, version: 0, dirty: false, saving: false, again: false })
  const timer = useRef(0)

  const write = useCallback(async (): Promise<boolean> => {
    const r = ref.current
    if (!r.dirty) return true
    if (r.saving) {
      r.again = true
      return true
    }
    if (!r.id && !hasContent(r.form)) return true
    r.saving = true
    r.dirty = false
    setState('saving')
    const snapshot = r.form
    try {
      const saved = r.id
        ? await api.patch<DiaryEntry>(`/api/diary/${r.id}`, { ...snapshot, version: r.version })
        : await api.post<DiaryEntry>('/api/diary', { ...snapshot, identity: r.identity, date_key: date })
      r.id = saved.id
      r.version = saved.version
      setEntryId(saved.id)
      if (ref.current.form === snapshot) {
        try {
          localStorage.removeItem(DRAFT_KEY(r.identity))
        } catch {
          /* ignore */
        }
      }
      setSavedAt(new Date().toISOString())
      setState(r.dirty ? 'dirty' : 'saved')
      qc.setQueryData(['diary-entry', saved.id], saved)
      void qc.invalidateQueries({ queryKey: ['diary-day', date] })
      void qc.invalidateQueries({ queryKey: ['diary-dates'] })
      void qc.invalidateQueries({ queryKey: ['diary-stats'] })
      onSaved?.(saved)
      return true
    } catch (err) {
      r.dirty = true
      if (err instanceof ApiError && err.status === 409) {
        setConflict((err.data as { current: DiaryEntry }).current)
        setState('conflict')
      } else {
        setState('error')
        // 稍后自动重试
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => void write(), 8000)
      }
      return false
    } finally {
      r.saving = false
      if (r.again) {
        r.again = false
        void write()
      }
    }
  }, [date, qc, onSaved])

  const update = useCallback(
    (patch: Partial<Form>) => {
      const r = ref.current
      r.form = { ...r.form, ...patch }
      r.dirty = true
      setForm(r.form)
      if (state !== 'conflict') setState('dirty')
      try {
        localStorage.setItem(DRAFT_KEY(r.identity), JSON.stringify({ date, id: r.id, form: r.form, at: Date.now() }))
      } catch {
        /* ignore */
      }
      clearTimeout(timer.current)
      if (state !== 'conflict') timer.current = window.setTimeout(() => void write(), 1200)
    },
    [date, state, write],
  )

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    return write()
  }, [write])

  /** 换到另一篇（或新的一篇）前先把手上这篇存好 */
  const load = useCallback(
    async (entry: DiaryEntry | null) => {
      await flush()
      const r = ref.current
      r.id = entry?.id ?? null
      r.identity = entry?.identity ?? uuid()
      r.version = entry?.version ?? 0
      r.dirty = false
      let next = entry ? fromEntry(entry) : EMPTY
      // 本机还留着比服务器更新的草稿（上次没来得及保存）→ 恢复
      try {
        const raw = localStorage.getItem(DRAFT_KEY(r.identity))
        if (raw) {
          const d = JSON.parse(raw)
          if (d.form && (!entry || d.at > Date.parse(entry.updated_at))) {
            next = d.form
            r.dirty = true
          }
        }
      } catch {
        /* ignore */
      }
      r.form = next
      setForm(next)
      setEntryId(r.id)
      setConflict(null)
      setSavedAt(entry?.updated_at ?? null)
      setState(r.dirty ? 'dirty' : entry ? 'saved' : 'idle')
      if (r.dirty) timer.current = window.setTimeout(() => void write(), 600)
    },
    [flush, write],
  )

  const resolve = useCallback(
    async (keep: 'mine' | 'theirs') => {
      if (!conflict) return
      const r = ref.current
      r.version = conflict.version
      if (keep === 'theirs') {
        r.form = fromEntry(conflict)
        r.dirty = false
        setForm(r.form)
        setConflict(null)
        setState('saved')
        try {
          localStorage.removeItem(DRAFT_KEY(r.identity))
        } catch {
          /* ignore */
        }
        return
      }
      setConflict(null)
      r.dirty = true
      await write()
    },
    [conflict, write],
  )

  // 关页面前把最后的改动送出去
  useEffect(() => {
    const onLeave = () => {
      const r = ref.current
      if (!r.dirty || !r.id) return
      void fetch(`/api/diary/${r.id}`, {
        method: 'PATCH',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...r.form, version: r.version }),
      })
    }
    addEventListener('pagehide', onLeave)
    return () => {
      removeEventListener('pagehide', onLeave)
      clearTimeout(timer.current)
      void write()
    }
  }, [write])

  return { form, update, state, savedAt, entryId, conflict, flush, load, resolve, identity: ref.current.identity }
}
