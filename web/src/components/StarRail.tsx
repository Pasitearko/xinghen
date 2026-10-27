// 星轨：左侧竖向导航。五个栏目是一条星座连线上的五颗星，当前所在的那颗亮起，
// 光晕在星与星之间滑过去（共享布局动画）。窄屏时变成底部的停靠栏。
import { AnimatePresence, motion } from 'motion/react'
import { Moon, Search, Settings2, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { SPRING_LAYOUT } from '../lib/motion'
import { resolvedTheme, switchTheme, usePrefs, useStore } from '../lib/store'
import { remaining, timer } from '../lib/timer'
import { preload, ROUTES } from '../routes'
import { Signature } from './Signature'
import './rail.css'

function StarGlyph({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`rail-star ${on ? 'rail-star--on' : ''}`} aria-hidden>
      <path d="M12 2.5l1.9 7.6 7.6 1.9-7.6 1.9L12 21.5l-1.9-7.6L2.5 12l7.6-1.9z" />
    </svg>
  )
}

/** 专注进行中时，「自习」下面显示剩余时间 */
function RailTimer({ fallback }: { fallback: string }) {
  const session = useStore(timer, (s) => s.session)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!session) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [session])
  if (!session) return <>{fallback}</>
  const s = Math.ceil(remaining() / 1000)
  return <span className="rail-timer">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}

export function StarRail({ onSearch, onSettings }: { onSearch: () => void; onSettings: () => void }) {
  const [loc] = useLocation()
  const theme = usePrefs((p) => resolvedTheme(p))
  const active = ROUTES.find((r) => (r.path === '/' ? loc === '/' : loc.startsWith(r.path)))?.path ?? '/'

  const themeBtn = (
    <button
      className="icon-btn rail-tool"
      aria-label={theme === 'night' ? '切换到晨间主题' : '切换到夜间主题'}
      title={theme === 'night' ? '晨间' : '夜间'}
      onClick={(e) => switchTheme(theme === 'night' ? 'dawn' : 'night', { x: e.clientX, y: e.clientY })}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          style={{ display: 'grid' }}
        >
          {theme === 'night' ? <Moon size={18} /> : <Sun size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )

  return (
    <>
      <nav className="rail" aria-label="栏目">
        <Link href="/" className="rail-brand" aria-label="星痕首页">
          <span className="rail-brand-text">星痕</span>
        </Link>
        <ul className="rail-list">
          <span className="rail-line" aria-hidden />
          {ROUTES.map((r) => {
            const on = r.path === active
            return (
              <li key={r.path}>
                <Link href={r.path} className={`rail-item ${on ? 'rail-item--on' : ''}`} aria-current={on ? 'page' : undefined} onPointerEnter={() => preload(r.path)} onFocus={() => preload(r.path)}>
                  <span className="rail-node">
                    {on && <motion.span layoutId="rail-glow" className="rail-glow" transition={SPRING_LAYOUT} />}
                    <StarGlyph on={on} />
                  </span>
                  <span className="rail-label">{r.path === '/study' ? <RailTimer fallback={r.label} /> : r.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="rail-tools">
          <button className="icon-btn rail-tool" onClick={onSearch} aria-label="搜索（Ctrl+K）" title="搜索  Ctrl K">
            <Search size={18} />
          </button>
          {themeBtn}
          <button className="icon-btn rail-tool" onClick={onSettings} aria-label="设置" title="设置">
            <Settings2 size={18} />
          </button>
        </div>
        <Signature />
      </nav>

      <nav className="dock glass" aria-label="栏目">
        {ROUTES.map((r) => {
          const on = r.path === active
          return (
            <Link key={r.path} href={r.path} className={`dock-item ${on ? 'dock-item--on' : ''}`} aria-current={on ? 'page' : undefined}>
              {on && <motion.span layoutId="dock-pill" className="dock-pill" transition={SPRING_LAYOUT} />}
              <StarGlyph on={on} />
              <span>{r.label}</span>
            </Link>
          )
        })}
        <button className="dock-item" onClick={onSettings} aria-label="设置">
          <Settings2 size={17} />
          <span>设置</span>
        </button>
      </nav>
    </>
  )
}
