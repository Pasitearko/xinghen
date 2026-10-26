// 天幕：渐变夜空 + 静态星点（只在尺寸变化时重画）+ 极光纱 + 偶尔划过的飞星 + 可选的雪/雨。
// 性能取舍：星星画一次后只用 CSS 透明度闪烁；极光是纯 CSS 渐变块，只动 transform；
// 只有选了雪/雨才会跑 rAF，且限 40fps、标签页隐藏时暂停。
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Wallpaper } from '../lib/api'
import { prefs, resolvedTheme, usePrefs } from '../lib/store'
import './sky.css'

function drawStars(canvas: HTMLCanvasElement, seed: number, density: number) {
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const w = innerWidth
  const h = innerHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const count = Math.round((w * h) / density)
  for (let i = 0; i < count; i++) {
    const x = rnd() * w
    // 越靠近地平线星越少
    const y = Math.pow(rnd(), 1.35) * h * 0.92
    const r = rnd() < 0.94 ? 0.35 + rnd() * 0.75 : 1.1 + rnd() * 0.9
    const tint = rnd()
    const color = tint < 0.7 ? '235,240,255' : tint < 0.88 ? '255,236,205' : '200,220,255'
    const a = 0.35 + rnd() * 0.6
    ctx.beginPath()
    ctx.fillStyle = `rgba(${color},${a})`
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (r > 1.5) {
      // 亮星带一圈柔光和十字星芒
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 6)
      g.addColorStop(0, `rgba(${color},0.35)`)
      g.addColorStop(1, `rgba(${color},0)`)
      ctx.fillStyle = g
      ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12)
      ctx.strokeStyle = `rgba(${color},0.28)`
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.moveTo(x - r * 5, y)
      ctx.lineTo(x + r * 5, y)
      ctx.moveTo(x, y - r * 5)
      ctx.lineTo(x, y + r * 5)
      ctx.stroke()
    }
  }
}

function StarField() {
  const a = useRef<HTMLCanvasElement>(null)
  const b = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let t = 0
    const paint = () => {
      if (a.current) drawStars(a.current, 7, 2600)
      if (b.current) drawStars(b.current, 131, 5200)
    }
    paint()
    const onResize = () => {
      clearTimeout(t)
      t = window.setTimeout(paint, 180)
    }
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])
  return (
    <div className="sky-stars">
      <canvas ref={a} className="sky-stars-a" />
      <canvas ref={b} className="sky-stars-b" />
    </div>
  )
}

interface Streak {
  id: number
  x: number
  y: number
  angle: number
  len: number
  dist: number
  dur: number
}

function Meteors({ enabled }: { enabled: boolean }) {
  const [list, setList] = useState<Streak[]>([])
  useEffect(() => {
    let id = 0
    const spawn = (bright = false) => {
      if (document.hidden) return
      const angle = 18 + Math.random() * 22
      setList((l) => [
        ...l.slice(-2),
        {
          id: ++id,
          x: innerWidth * (0.25 + Math.random() * 0.7),
          y: innerHeight * (Math.random() * 0.35),
          angle,
          len: bright ? 260 : 140 + Math.random() * 120,
          dist: bright ? 520 : 300 + Math.random() * 260,
          dur: bright ? 1.15 : 0.9 + Math.random() * 0.5,
        },
      ])
    }
    const onEvent = () => spawn(true)
    addEventListener('feixing:meteor', onEvent)
    let timer = 0
    const loop = () => {
      timer = window.setTimeout(() => {
        if (enabled && prefs.get().motion === 'full') spawn()
        loop()
      }, 22000 + Math.random() * 46000)
    }
    loop()
    return () => {
      removeEventListener('feixing:meteor', onEvent)
      clearTimeout(timer)
    }
  }, [enabled])
  return (
    <div className="sky-meteors">
      <AnimatePresence>
        {list.map((m) => {
          const rad = (m.angle * Math.PI) / 180
          return (
            <motion.span
              key={m.id}
              className="meteor"
              style={{ left: m.x, top: m.y, width: m.len, rotate: -m.angle }}
              initial={{ x: 0, y: 0, opacity: 0 }}
              animate={{ x: -Math.cos(rad) * m.dist, y: Math.sin(rad) * m.dist, opacity: [0, 1, 1, 0] }}
              transition={{ duration: m.dur, ease: [0.3, 0.1, 0.6, 1], opacity: { times: [0, 0.15, 0.6, 1], duration: m.dur } }}
              onAnimationComplete={() => setList((l) => l.filter((x) => x.id !== m.id))}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/** 雪 / 雨：只在选中时运行。鼠标附近的雪会被轻轻拨开。 */
function Particles({ kind }: { kind: 'snow' | 'rain' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let w = 0
    let h = 0
    const mouse = { x: -999, y: -999 }
    type P = { x: number; y: number; v: number; r: number; d: number; a: number }
    let ps: P[] = []
    const make = (top = false): P => ({
      x: Math.random() * w,
      y: top ? -10 : Math.random() * h,
      v: kind === 'snow' ? 0.25 + Math.random() * 0.7 : 7 + Math.random() * 6,
      r: kind === 'snow' ? 0.8 + Math.random() * 2.2 : 10 + Math.random() * 14,
      d: Math.random() * Math.PI * 2,
      a: 0.3 + Math.random() * 0.55,
    })
    const resize = () => {
      w = canvas.width = innerWidth
      h = canvas.height = innerHeight
      const n = Math.round((w * h) / (kind === 'snow' ? 9000 : 6000))
      ps = Array.from({ length: n }, () => make())
    }
    resize()
    addEventListener('resize', resize)
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
    }
    addEventListener('pointermove', onMove, { passive: true })
    let raf = 0
    let last = 0
    const night = () => resolvedTheme() === 'night'
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden || now - last < 24) return
      const dt = Math.min(3, (now - last) / 16.7)
      last = now
      ctx.clearRect(0, 0, w, h)
      const c = night() ? '230,238,255' : '90,110,150'
      if (kind === 'rain') {
        ctx.strokeStyle = `rgba(${c},0.28)`
        ctx.lineWidth = 1
        ctx.beginPath()
        for (const p of ps) {
          p.y += p.v * dt
          p.x -= p.v * 0.18 * dt
          if (p.y > h) Object.assign(p, make(true))
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x + p.r * 0.18, p.y - p.r)
        }
        ctx.stroke()
      } else {
        for (const p of ps) {
          p.d += 0.01 * dt
          p.y += p.v * dt
          p.x += Math.sin(p.d) * 0.35 * dt
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const dd = dx * dx + dy * dy
          if (dd < 9000) {
            const f = (1 - dd / 9000) * 1.6 * dt
            p.x += (dx / Math.sqrt(dd + 1)) * f
            p.y += (dy / Math.sqrt(dd + 1)) * f * 0.4
          }
          if (p.y > h + 5) Object.assign(p, make(true))
          ctx.globalAlpha = p.a
          ctx.fillStyle = `rgb(${c})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
      removeEventListener('pointermove', onMove)
    }
  }, [kind])
  return <canvas ref={ref} className="sky-particles" />
}

function WallpaperLayer() {
  const theme = usePrefs((p) => resolvedTheme(p))
  const dim = usePrefs((p) => p.wallpaperDim)
  const { data } = useQuery({
    queryKey: ['wallpapers'],
    queryFn: () => api.get<{ items: Wallpaper[]; selected: { dark: string; light: string } }>('/api/wallpapers'),
    staleTime: Infinity,
  })
  const id = data ? (theme === 'night' ? data.selected.dark : data.selected.light) : 'sky'
  const wp = data?.items.find((w) => w.id === id)
  const [loaded, setLoaded] = useState<string | null>(null)
  if (!wp) return null
  return (
    <div className="sky-wallpaper" style={{ opacity: loaded === wp.url ? 1 : 0 }}>
      <img src={wp.url} alt="" onLoad={() => setLoaded(wp.url)} decoding="async" />
      <div className="sky-wallpaper-dim" style={{ opacity: dim }} />
    </div>
  )
}

export function Sky() {
  const ambient = usePrefs((p) => p.ambient)
  const aurora = usePrefs((p) => p.aurora)
  const meteors = usePrefs((p) => p.meteors)
  const reduced = usePrefs((p) => p.motion === 'reduced')
  const root = useRef<HTMLDivElement>(null)

  // 视差：星空与极光随鼠标反向轻移，停下后自动停止 rAF
  useEffect(() => {
    if (reduced || matchMedia('(pointer: coarse)').matches) return
    const target = { x: 0, y: 0 }
    const cur = { x: 0, y: 0 }
    let raf = 0
    const step = () => {
      cur.x += (target.x - cur.x) * 0.06
      cur.y += (target.y - cur.y) * 0.06
      root.current?.style.setProperty('--px', cur.x.toFixed(2))
      root.current?.style.setProperty('--py', cur.y.toFixed(2))
      raf = Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.01 ? requestAnimationFrame(step) : 0
    }
    const onMove = (e: PointerEvent) => {
      target.x = e.clientX / innerWidth - 0.5
      target.y = e.clientY / innerHeight - 0.5
      if (!raf) raf = requestAnimationFrame(step)
    }
    addEventListener('pointermove', onMove, { passive: true })
    return () => {
      removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [reduced])

  return (
    <div className="sky" ref={root} aria-hidden>
      <div className="sky-gradient" />
      <WallpaperLayer />
      {aurora && (
        <div className="sky-aurora">
          <span className="aurora-a" />
          <span className="aurora-b" />
          <span className="aurora-c" />
        </div>
      )}
      {ambient === 'stars' && <StarField />}
      {(ambient === 'snow' || ambient === 'rain') && !reduced && <Particles kind={ambient} />}
      <div className="sky-horizon" />
      <Meteors enabled={meteors} />
    </div>
  )
}
