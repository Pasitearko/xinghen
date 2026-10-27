// 星屑：在空白处点一下，落下一颗小星，荡开一圈涟漪、溅出几粒星屑。
// 两秒内接着点，新星会和上一颗连成一笔星座线——随手点几下就是一个小星座。
// 全部用 Web Animations 直接驱动 DOM，不经过 React 渲染；结束即移除。
import { useEffect, useRef } from 'react'
import { usePrefs } from '../lib/store'
import './stardust.css'

/** 点在这些东西上属于正常操作，不落星 */
const BLOCK =
  'a, button, input, textarea, select, label, summary, [role="button"], [role="dialog"], [role="listbox"], [contenteditable], .glass, .rail, .dock, .sheet-root, .pal-root, img, video, audio, canvas'

const CHAIN_MS = 2200
const CHAIN_PX = 560
const NS = 'http://www.w3.org/2000/svg'

function el(cls: string, x: number, y: number) {
  const d = document.createElement('span')
  d.className = cls
  d.style.left = `${x}px`
  d.style.top = `${y}px`
  return d
}

export function Stardust() {
  const layer = useRef<HTMLDivElement>(null)
  const lines = useRef<SVGSVGElement>(null)
  const reduced = usePrefs((p) => p.motion === 'reduced')

  useEffect(() => {
    if (reduced || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let last: { x: number; y: number; t: number } | null = null
    const done = (node: Element) => () => node.remove()

    const spawn = (x: number, y: number) => {
      const box = layer.current
      const svg = lines.current
      if (!box || !svg) return
      const now = performance.now()
      const chained = !!last && now - last.t < CHAIN_MS && Math.hypot(x - last.x, y - last.y) < CHAIN_PX && Math.hypot(x - last.x, y - last.y) > 10

      // 星：先弹出、转正，停留一会儿（连星座时停得更久），再暗下去
      const star = el('sd-star', x, y)
      star.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 1.5l2.1 8.4 8.4 2.1-8.4 2.1L12 22.5l-2.1-8.4L1.5 12l8.4-2.1z"/></svg>'
      box.append(star)
      star
        .animate(
          [
            { transform: 'translate(-50%,-50%) scale(0) rotate(-60deg)', opacity: 0 },
            { transform: 'translate(-50%,-50%) scale(1.25) rotate(0deg)', opacity: 1, offset: 0.12 },
            { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 0.95, offset: 0.24 },
            { transform: 'translate(-50%,-50%) scale(0.85) rotate(20deg)', opacity: 0.7, offset: 0.7 },
            { transform: 'translate(-50%,-50%) scale(0.2) rotate(45deg)', opacity: 0 },
          ],
          { duration: 2600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        )
        .addEventListener('finish', done(star))

      // 涟漪
      const ring = el('sd-ring', x, y)
      box.append(ring)
      ring
        .animate([{ transform: 'translate(-50%,-50%) scale(0.15)', opacity: 0.7 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }], {
          duration: 900,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        })
        .addEventListener('finish', done(ring))

      // 星屑：六粒，向外飞散并轻轻下坠
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.6
        const r = 22 + Math.random() * 30
        const dx = Math.cos(a) * r
        const dy = Math.sin(a) * r
        const p = el('sd-spark', x, y)
        box.append(p)
        p.animate(
          [
            { transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 },
            { transform: `translate(-50%,-50%) translate(${dx}px,${dy + 14}px) scale(0.3)`, opacity: 0 },
          ],
          { duration: 700 + Math.random() * 450, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
        ).addEventListener('finish', done(p))
      }

      // 星座线：从上一颗星画过来，停一会儿再淡出
      if (chained && last) {
        const line = document.createElementNS(NS, 'line')
        line.setAttribute('x1', String(last.x))
        line.setAttribute('y1', String(last.y))
        line.setAttribute('x2', String(x))
        line.setAttribute('y2', String(y))
        const len = Math.hypot(x - last.x, y - last.y)
        line.style.strokeDasharray = `${len}`
        svg.append(line)
        line
          .animate(
            [
              { strokeDashoffset: len, opacity: 0.9 },
              { strokeDashoffset: 0, opacity: 0.9, offset: 0.16 },
              { strokeDashoffset: 0, opacity: 0.6, offset: 0.7 },
              { strokeDashoffset: 0, opacity: 0 },
            ],
            { duration: 2600, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
          )
          .addEventListener('finish', done(line))
      }
      last = { x, y, t: now }
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest(BLOCK)) return
      spawn(e.clientX, e.clientY)
    }
    addEventListener('pointerdown', onDown, { passive: true })
    return () => removeEventListener('pointerdown', onDown)
  }, [reduced])

  return (
    <>
      <svg ref={lines} className="sd-lines" aria-hidden />
      <div ref={layer} className="sd-layer" aria-hidden />
    </>
  )
}
