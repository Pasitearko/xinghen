// 极小的全局状态：订阅 + 快照，配合 useSyncExternalStore，不引状态库。
import { useSyncExternalStore } from 'react'

export function createStore<T>(initial: T) {
  let state = initial
  const subs = new Set<() => void>()
  return {
    get: () => state,
    set(next: Partial<T> | ((s: T) => Partial<T>)) {
      const patch = typeof next === 'function' ? next(state) : next
      state = { ...state, ...patch }
      subs.forEach((fn) => fn())
    },
    subscribe(fn: () => void) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}

export function useStore<T, S>(store: ReturnType<typeof createStore<T>>, pick: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()))
}

// ---------- 偏好（只存本浏览器）----------
export type ThemePref = 'night' | 'dawn' | 'auto'
export type Ambient = 'stars' | 'snow' | 'rain' | 'none'

export interface Prefs {
  theme: ThemePref
  ambient: Ambient
  aurora: boolean
  meteors: boolean
  editorFont: 'serif' | 'kai'
  motion: 'full' | 'reduced'
  wallpaperDim: number
  volume: number
}

const DEFAULT_PREFS: Prefs = {
  theme: 'auto',
  ambient: 'stars',
  aurora: true,
  meteors: true,
  editorFont: 'serif',
  motion: 'full',
  wallpaperDim: 0.45,
  volume: 0.7,
}

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('xinghen.prefs') || '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

export const prefs = createStore<Prefs>(loadPrefs())
prefs.subscribe(() => {
  try {
    localStorage.setItem('xinghen.prefs', JSON.stringify(prefs.get()))
  } catch {
    /* 隐私模式下写不进去也无妨 */
  }
})

export const usePrefs = <S,>(pick: (p: Prefs) => S) => useStore(prefs, pick)

const systemLight = matchMedia('(prefers-color-scheme: light)')

export function resolvedTheme(p = prefs.get()): 'night' | 'dawn' {
  if (p.theme === 'night' || p.theme === 'dawn') return p.theme
  return systemLight.matches ? 'dawn' : 'night'
}

function applyRoot() {
  const p = prefs.get()
  document.documentElement.dataset.theme = resolvedTheme(p)
  document.documentElement.dataset.motion = p.motion
}
applyRoot()
prefs.subscribe(applyRoot)
systemLight.addEventListener('change', () => {
  if (prefs.get().theme === 'auto') prefs.set({})
})

/** 换主题：支持 View Transitions 时从点击处画圆扩散，否则直接切。 */
export function switchTheme(next: ThemePref, origin?: { x: number; y: number }) {
  const from = resolvedTheme()
  const to = resolvedTheme({ ...prefs.get(), theme: next })
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  if (from === to || !doc.startViewTransition || prefs.get().motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    prefs.set({ theme: next })
    return
  }
  const x = origin?.x ?? innerWidth - 40
  const y = origin?.y ?? 40
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const vt = doc.startViewTransition(() => prefs.set({ theme: next }))
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 900, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
}

// ---------- 轻提示 ----------
export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error' | 'info'
}
export const toasts = createStore<{ items: Toast[] }>({ items: [] })
let toastId = 0
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const id = ++toastId
  toasts.set((s) => ({ items: [...s.items.slice(-3), { id, text, tone }] }))
  setTimeout(() => toasts.set((s) => ({ items: s.items.filter((t) => t.id !== id) })), tone === 'error' ? 5200 : 2800)
}

// ---------- 流星：保存成功等时刻划过一颗 ----------
export function meteor() {
  window.dispatchEvent(new CustomEvent('xinghen:meteor'))
}
