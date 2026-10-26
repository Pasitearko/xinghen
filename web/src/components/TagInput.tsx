import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { SPRING_LAYOUT } from '../lib/motion'

/** 标签输入：回车、逗号或顿号确认，点一下已有标签移除。 */
export function TagInput({ tags, onChange, label = '标签' }: { tags: string[]; onChange: (t: string[]) => void; label?: string }) {
  const [text, setText] = useState('')
  const commit = () => {
    const parts = text.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
    if (parts.length) onChange([...new Set([...tags, ...parts])].slice(0, 20))
    setText('')
  }
  return (
    <div className="picker">
      {label && <span className="picker-label">{label}</span>}
      <div className="picker-chips">
        <AnimatePresence initial={false}>
          {tags.map((t) => (
            <motion.button
              key={t}
              layout
              className="chip tag-chip"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              title="点一下移除"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={SPRING_LAYOUT}
            >
              #{t}
            </motion.button>
          ))}
        </AnimatePresence>
        <input
          className="chip chip-input"
          value={text}
          placeholder={tags.length ? '再加一个' : '加标签，回车确认'}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && !e.nativeEvent.isComposing) {
              e.preventDefault()
              commit()
            } else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1))
          }}
        />
      </div>
    </div>
  )
}

