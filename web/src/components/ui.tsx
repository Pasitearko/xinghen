// 通用小部件。动效思路取自 react-bits 与 starc007/ui-components，按本站需要重写：
// 滑动选中底（Tabs）、逐位滚动数字（Ticker）、弹簧勾选（Check）、开关（Switch）、弹窗（Sheet）、轻提示（Toasts）。
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { EASE_OUT, SPRING_LAYOUT, SPRING_PANEL } from '../lib/motion'
import { toasts, useStore } from '../lib/store'
import './ui.css'

// ---------- Tabs：选中底在选项之间滑动 ----------
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; count?: number }[]
  size?: 'sm' | 'md'
  label?: string
}) {
  const id = useId()
  return (
    <div className={`tabs tabs--${size}`} role="tablist" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            className={`tab ${on ? 'tab--on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {on && <motion.span layoutId={`tab-${id}`} className="tab-pill" transition={SPRING_LAYOUT} />}
            <span className="tab-label">
              {o.label}
              {o.count !== undefined && <span className="tab-count">{o.count}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------- Ticker：数字逐位滚动 ----------
function Digit({ d, delay }: { d: number; delay: number }) {
  const reduce = useReducedMotion()
  const y = useMotionValue(-d * 10)
  const ty = useTransform(y, (v) => `${v}%`)
  useEffect(() => {
    if (reduce) {
      y.jump(-d * 10)
      return
    }
    const c = animate(y, -d * 10, { duration: 0.9, delay, ease: EASE_OUT })
    return () => c.stop()
  }, [d, delay, reduce, y])
  return (
    <span className="digit">
      <motion.span className="digit-col" style={{ y: ty }}>
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n}>{n}</span>
        ))}
      </motion.span>
    </span>
  )
}

export function Ticker({ value, className = '', format }: { value: number; className?: string; format?: (n: number) => string }) {
  const text = format ? format(value) : String(Math.round(value))
  const chars = text.split('')
  return (
    <span className={`ticker ${className}`} aria-label={text}>
      {chars.map((c, i) => {
        // 按「从右数第几位」做 key：数字变大时左边加位，原有的位不重挂、继续滚动
        const place = chars.length - i
        return /\d/.test(c) ? (
          <Digit key={`d${place}`} d={Number(c)} delay={(chars.length - i) * 0.04} />
        ) : (
          <span key={`s${place}`} className="ticker-sep" aria-hidden>
            {c}
          </span>
        )
      })}
    </span>
  )
}

// ---------- Check：弹簧勾选 + 划线 ----------
export function Check({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode }) {
  const reduce = useReducedMotion()
  const t = useMotionValue(checked ? 1 : 0)
  const fill = useTransform(t, (v) => `scale(${Math.max(0, Math.min(1.1, v))})`)
  const tick = useTransform(t, (v) => 1 - Math.max(0, Math.min(1, v)))
  const rule = useTransform(t, (v) => `scaleX(${Math.max(0, Math.min(1, (v - 0.12) / 0.72))})`)
  const word = useTransform(t, (v) => 1 - 0.5 * Math.max(0, Math.min(1, v)))
  useLayoutEffect(() => {
    if (reduce) {
      t.jump(checked ? 1 : 0)
      return
    }
    const c = animate(t, checked ? 1 : 0, { type: 'spring', visualDuration: 0.28, bounce: 0.35 })
    return () => c.stop()
  }, [checked, reduce, t])
  return (
    <button type="button" role="checkbox" aria-checked={checked} className="check" onClick={() => onChange(!checked)}>
      <span className="check-box">
        <motion.span className="check-fill" style={{ transform: fill }} />
        <svg viewBox="0 0 24 24" className="check-tick" aria-hidden>
          <motion.path d="M5 12.5l4.2 4.2L19 7" pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: tick }} />
        </svg>
      </span>
      <span className="check-text">
        <motion.span className="check-label" style={{ opacity: word }}>
          {label}
          <motion.span className="check-rule" style={{ transform: rule }} />
        </motion.span>
        {sub && <span className="check-sub">{sub}</span>}
      </span>
    </button>
  )
}

// ---------- Switch ----------
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'switch--on' : ''}`} onClick={() => onChange(!checked)}>
      <motion.span className="switch-knob" layout transition={{ type: 'spring', stiffness: 520, damping: 34 }} />
    </button>
  )
}

// ---------- Sheet：居中弹窗 / 右侧抽屉 ----------
export function Sheet({
  open,
  onClose,
  title,
  children,
  side = 'center',
  width = 640,
  layoutId,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  side?: 'center' | 'right'
  width?: number
  layoutId?: string
  footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button')?.focus(), 60)
    return () => {
      removeEventListener('keydown', onKey)
      clearTimeout(t)
      prev?.focus?.()
    }
  }, [open, onClose])
  const variants =
    side === 'right'
      ? { initial: { x: 40, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: 40, opacity: 0 } }
      : layoutId
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
        : { initial: { y: 16, scale: 0.98, opacity: 0 }, animate: { y: 0, scale: 1, opacity: 1 }, exit: { y: 10, scale: 0.985, opacity: 0 } }
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={`sheet-root sheet-root--${side}`}>
          <motion.div className="sheet-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal
            className={`sheet glass sheet--${side}`}
            style={{ maxWidth: width }}
            layoutId={layoutId}
            {...variants}
            transition={SPRING_PANEL}
          >
            {title !== undefined && (
              <header className="sheet-head">
                <h2 className="sheet-title">{title}</h2>
                <button className="icon-btn" onClick={onClose} aria-label="关闭">
                  <X size={18} />
                </button>
              </header>
            )}
            <motion.div className="sheet-body" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.08, duration: 0.3 } }}>
              {children}
            </motion.div>
            {footer && <footer className="sheet-foot">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ---------- 确认 ----------
export function Confirm({
  open,
  title,
  body,
  confirmText,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body?: ReactNode
  confirmText: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            data-autofocus
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      {body && <p className="muted">{body}</p>}
    </Sheet>
  )
}

// ---------- 轻提示：右下角堆叠 ----------
export function Toasts() {
  const items = useStore(toasts, (s) => s.items)
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast glass toast--${t.tone}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
            transition={SPRING_PANEL}
          >
            <span className="toast-dot" />
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

/** 鼠标处一团柔光（SpotlightCard 的做法）：只改 CSS 变量，不触发重排。 */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || matchMedia('(pointer: coarse)').matches) return
    // 一帧里可能来好几次 pointermove，合并成一次读尺寸、一次写样式
    let raf = 0
    let x = 0
    let y = 0
    const paint = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${x - r.left}px`)
      el.style.setProperty('--my', `${y - r.top}px`)
    }
    const move = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      if (!raf) raf = requestAnimationFrame(paint)
    }
    el.addEventListener('pointermove', move)
    return () => {
      el.removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [])
  return ref
}
