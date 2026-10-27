// 落款：星轨最底下一颗很暗的小星，悬停或点开才露出作者的 GitHub 与邮箱。
// 设置面板底部也放一份，窄屏没有星轨时从那里找。
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Copy, Mail } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SPRING_PANEL } from '../lib/motion'
import { toast } from '../lib/store'

export const GITHUB = 'https://github.com/Pasitearko'
export const EMAIL = 'jiuliyearli@gmail.com'

export function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(EMAIL)
    toast('邮箱已复制')
  } catch {
    location.href = `mailto:${EMAIL}`
  }
}

/** 两行联系方式：GitHub 打开主页，邮箱点一下复制 */
export function ContactLinks() {
  return (
    <div className="contact">
      <a className="contact-row" href={GITHUB} target="_blank" rel="noreferrer noopener">
        <GithubMark />
        <span className="contact-text">Pasitearko</span>
        <ArrowUpRight size={13} className="contact-go" />
      </a>
      <button className="contact-row" onClick={() => void copyEmail()} title="点一下复制">
        <Mail size={16} />
        <span className="contact-text">{EMAIL}</span>
        <Copy size={13} className="contact-go" />
      </button>
    </div>
  )
}

export function Signature() {
  const [open, setOpen] = useState(false)
  const leave = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('pointerdown', onDown)
      removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div
      ref={box}
      className="sig"
      onPointerEnter={() => {
        clearTimeout(leave.current)
        setOpen(true)
      }}
      onPointerLeave={() => {
        leave.current = window.setTimeout(() => setOpen(false), 260)
      }}
    >
      <button className={`sig-star ${open ? 'sig-star--on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="作者的联系方式" aria-expanded={open}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 4l1.4 6.6L20 12l-6.6 1.4L12 20l-1.4-6.6L4 12l6.6-1.4z" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="sig-card glass"
            role="dialog"
            aria-label="作者"
            initial={{ opacity: 0, x: -10, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.98, transition: { duration: 0.16 } }}
            transition={SPRING_PANEL}
          >
            <ContactLinks />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
