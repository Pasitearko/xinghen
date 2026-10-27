// 问问自己：从题库里抽一题，不想答就换；选一个方向只在那一类里抽。
// 每个方向各自洗一副牌，一张张往下翻，翻完才重洗，所以短时间内不会重复。
import { AnimatePresence, motion } from 'motion/react'
import { PenLine, Shuffle } from 'lucide-react'
import { memo, useState } from 'react'
import { EASE_OUT } from '../../lib/motion'
import { PROMPT_COUNT, PROMPTS } from './prompts'

const ALL = '随便'
const KEY = 'feixing.prompt'

type Card = { group: string; text: string }

function pool(group: string): Card[] {
  return PROMPTS.filter((g) => group === ALL || g.name === group).flatMap((g) => g.items.map((text) => ({ group: g.name, text })))
}

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const decks = new Map<string, Card[]>()
function draw(group: string, not?: string): Card {
  let deck = decks.get(group)
  if (!deck?.length) {
    deck = shuffle(pool(group))
    // 刚洗好的牌别正好又是眼前这一题
    if (deck.length > 1 && deck[deck.length - 1].text === not) deck.unshift(deck.pop()!)
    decks.set(group, deck)
  }
  return deck.pop()!
}

function restore(): { group: string; card: Card } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as { group: string; card: Card } | null
    if (saved && pool(saved.group).some((c) => c.text === saved.card.text)) return saved
  } catch {
    /* 读不到就重新抽 */
  }
  return { group: ALL, card: draw(ALL) }
}

// 写字时整个书桌会跟着重渲染，这块和正文无关，props 不变就跳过
export const Inspiration = memo(function Inspiration({ onUse }: { onUse: (question: string) => void }) {
  const [state, setState] = useState(restore)
  const { group, card } = state
  const [turns, setTurns] = useState(0)

  const set = (next: { group: string; card: Card }) => {
    setState(next)
    setTurns((n) => n + 1)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* 存不下也不影响抽题 */
    }
  }
  const next = () => set({ group, card: draw(group, card.text) })
  const choose = (g: string) => g !== group && set({ group: g, card: draw(g, card.text) })

  return (
    <section className="glass panel-pad muse">
      <div className="panel-title">
        <span>问问自己</span>
        <small className="muse-count">{PROMPT_COUNT} 题</small>
      </div>

      <div className="muse-groups" role="radiogroup" aria-label="题目方向">
        {[ALL, ...PROMPTS.map((g) => g.name)].map((g) => (
          <button key={g} role="radio" aria-checked={g === group} className={`chip chip--xs ${g === group ? 'chip--on' : ''}`} onClick={() => choose(g)}>
            {g}
          </button>
        ))}
      </div>

      <div className="muse-card" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.blockquote
            key={card.text}
            className="muse-q"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.36, ease: EASE_OUT }}
          >
            {group === ALL && <span className="muse-from">{card.group}</span>}
            {card.text}
          </motion.blockquote>
        </AnimatePresence>
      </div>

      <div className="muse-foot">
        <button className="btn btn--sm btn--ghost" onClick={() => onUse(card.text)} title="把这个问题写进正文">
          <PenLine size={14} />
          写进日记
        </button>
        <button className="btn btn--sm" onClick={next}>
          <motion.span className="muse-spin" animate={{ rotate: turns * 180 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
            <Shuffle size={14} />
          </motion.span>
          换一题
        </button>
      </div>
    </section>
  )
})
