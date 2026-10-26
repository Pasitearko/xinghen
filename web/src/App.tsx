import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Router, useLocation } from 'wouter'
import { Sky } from './components/Sky'
import { Stardust } from './components/Stardust'
import { StarRail } from './components/StarRail'
import { Toasts } from './components/ui'
import { prefs } from './lib/store'
import { ensureTicker } from './lib/timer'
import { PAGES, preloadAll, ROUTES, type RoutePath } from './routes'

const Player = lazy(() => import('./components/Player'))
const Settings = lazy(() => import('./components/Settings'))
const Palette = lazy(() => import('./components/Palette'))

function base(loc: string): RoutePath {
  const hit = ROUTES.find((r) => r.path !== '/' && loc.startsWith(r.path))
  return hit ? hit.path : '/'
}

type Nav = (to: string, opts?: { replace?: boolean }) => void
type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }

/**
 * 换栏目时用 View Transition 整页交叉淡化。快照是整张页面（含天幕），
 * 所以过渡中面板的毛玻璃一直在；而不是给页面容器做 opacity/filter 动画——
 * 祖先只要带着这两样，里面的 backdrop-filter 就会失效，模糊要等动画结束才出现。
 */
function aroundNav(nav: Nav, to: string, opts?: { replace?: boolean }) {
  const doc = document as VTDoc
  const quiet = prefs.get().motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || quiet || base(to.split('?')[0]) === base(location.pathname)) {
    nav(to, opts)
    return
  }
  const root = document.documentElement
  root.classList.add('vt-page')
  doc.startViewTransition(() => flushSync(() => nav(to, opts))).finished.finally(() => root.classList.remove('vt-page'))
}

export default function App() {
  return (
    <Router aroundNav={aroundNav}>
      <Shell />
    </Router>
  )
}

function Shell() {
  const [loc] = useLocation()
  const path = base(loc)
  const Page = PAGES[path]
  const [settings, setSettings] = useState(false)
  const [palette, setPalette] = useState(false)

  useEffect(() => {
    document.title = ROUTES.find((r) => r.path === path)?.title || '飞星'
  }, [path])
  useLayoutEffect(() => {
    scrollTo({ top: 0 })
  }, [path])

  useEffect(() => {
    preloadAll()
    ensureTicker()
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <Sky />
      <StarRail onSearch={() => setPalette(true)} onSettings={() => setSettings(true)} />
      <div className="shell">
        {/* 进场动画交给 CSS：每块面板自己淡入（.glass 的 rise），容器本身不做透明度动画 */}
        <main key={path}>
          <Suspense fallback={<div className="page" />}>
            <Page />
          </Suspense>
        </main>
      </div>
      <Suspense fallback={null}>
        <Player />
        {settings && <Settings open={settings} onClose={() => setSettings(false)} />}
        {palette && <Palette open={palette} onClose={() => setPalette(false)} />}
      </Suspense>
      <Stardust />
      <Toasts />
    </>
  )
}
