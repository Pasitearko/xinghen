import { lazy } from 'react'

const loaders = {
  '/': () => import('./pages/Home'),
  '/diary': () => import('./pages/Diary'),
  '/taste': () => import('./pages/Taste'),
  '/study': () => import('./pages/Study'),
  '/archive': () => import('./pages/Archive'),
} as const

export type RoutePath = keyof typeof loaders

export const ROUTES: { path: RoutePath; label: string; title: string }[] = [
  { path: '/', label: '首页', title: '飞星' },
  { path: '/diary', label: '日记', title: '日记 · 飞星' },
  { path: '/taste', label: '品味', title: '品味库 · 飞星' },
  { path: '/study', label: '自习', title: '自习室 · 飞星' },
  { path: '/archive', label: '档案', title: '档案室 · 飞星' },
]

export const PAGES = Object.fromEntries(Object.entries(loaders).map(([k, load]) => [k, lazy(load)])) as unknown as Record<RoutePath, ReturnType<typeof lazy>>

const done = new Set<string>()
/** 悬停导航时提前下载页面代码，点下去就是瞬开。 */
export function preload(path: RoutePath) {
  if (done.has(path)) return
  done.add(path)
  void loaders[path]()
}

/** 首页渲染完后空闲时把其余页面也拉下来 */
export function preloadAll() {
  const run = () => ROUTES.forEach((r) => preload(r.path))
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
