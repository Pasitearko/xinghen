// 专注计时：全局唯一，按服务器记录的开始时间计算剩余，切页、后台标签页节流都不会漂移。
// 到点时自动结束并记录；多个标签页同时到点，服务端按 session_id 只记一次。
import { api, type StudySession, type StudyToday } from './api'
import { createStore, meteor, toast } from './store'

interface TimerState {
  session: StudySession | null
  /** 休息倒计时的结束时间（只在本机，不记录） */
  breakUntil: number | null
  breakMinutes: number
  loaded: boolean
}

export const timer = createStore<TimerState>({ session: null, breakUntil: null, breakMinutes: 5, loaded: false })

let onChange: (() => void) | null = null
export function onTimerChange(fn: () => void) {
  onChange = fn
}

export async function syncTimer() {
  try {
    const today = await api.get<StudyToday>('/api/study/today')
    timer.set({ session: today.active, loaded: true })
    return today
  } catch {
    timer.set({ loaded: true })
    return null
  }
}

export function remaining(now = Date.now()) {
  const s = timer.get().session
  if (!s) return 0
  return Math.max(0, Date.parse(s.started_at) + s.planned_minutes * 60_000 - now)
}

export async function startFocus(minutes: number, todoId: number | null, breakMinutes = 5) {
  const session_id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  try {
    const s = await api.post<StudySession>('/api/study/sessions', { session_id, todo_id: todoId, planned_minutes: minutes })
    timer.set({ session: s, breakUntil: null, breakMinutes })
    void Notification?.requestPermission?.()
    onChange?.()
  } catch (e) {
    toast((e as Error).message, 'error')
    await syncTimer()
  }
}

let finishing = false
export async function finishFocus(status: 'finished' | 'abandoned' = 'finished') {
  const s = timer.get().session
  if (!s || finishing) return
  finishing = true
  const focused = Math.round((Date.now() - Date.parse(s.started_at)) / 1000)
  try {
    const done = await api.post<StudySession>(`/api/study/sessions/${s.session_id}/finish`, { focused_seconds: Math.min(focused, s.planned_minutes * 60), status })
    const full = done.pomodoros > 0
    timer.set({ session: null, breakUntil: full && timer.get().breakMinutes ? Date.now() + timer.get().breakMinutes * 60_000 : null })
    if (full) {
      chime()
      meteor()
      toast(`专注了 ${s.planned_minutes} 分钟，记下一个番茄`)
      notify('一个番茄完成了', `专注了 ${s.planned_minutes} 分钟，起来走走吧。`)
    } else if (done.status === 'finished') {
      toast(`提前结束，记了 ${Math.round(done.focused_seconds / 60)} 分钟`, 'info')
    } else {
      toast('已放弃这次专注', 'info')
    }
  } catch (e) {
    toast((e as Error).message, 'error')
  } finally {
    finishing = false
    onChange?.()
  }
}

export function skipBreak() {
  timer.set({ breakUntil: null })
}

/** 用 Web Audio 合成两声轻柔的钟音，不需要音频文件。 */
export function chime() {
  try {
    const ctx = new AudioContext()
    const notes = [659.25, 987.77]
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.28
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 1.7)
    })
    setTimeout(() => void ctx.close(), 2500)
  } catch {
    /* 没有音频设备也无妨 */
  }
}

function notify(title: string, body: string) {
  try {
    if (document.hidden && Notification.permission === 'granted') new Notification(title, { body, icon: '/favicon.svg' })
  } catch {
    /* ignore */
  }
}

// 全局轮询：每秒检查是否到点；标签页回到前台时立刻检查
let ticking = false
export function ensureTicker() {
  if (ticking) return
  ticking = true
  void syncTimer()
  const check = () => {
    const s = timer.get().session
    if (s && remaining() <= 0) void finishFocus('finished')
    const b = timer.get().breakUntil
    if (b && Date.now() >= b) {
      timer.set({ breakUntil: null })
      chime()
      toast('休息结束了')
      notify('休息结束', '可以开始下一个番茄了。')
    }
  }
  setInterval(check, 1000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void syncTimer()
      check()
    }
  })
}
