// 打字的手感：刚落下的字带一点金色微光，半秒内沉成墨色；光标处同时飘起一粒很小的星点。
// 只给键盘打出来的字和输入法里的拼音、上屏的字；粘贴、撤销、换篇都不算。
// 拼音还在组字时不能改正文的 DOM（会打断输入法候选），那段的微光改用 CSS Highlight 画，不碰节点。
import type { Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** 和 diary.css 里 ink-settle 的时长一致，过了就把标记收掉 */
const SETTLE = 520

type Fresh = { from: number; to: number; t: number }

/** 拼音的微光分三档从亮到暗，对应 diary.css 里的 ::highlight(ink-pinyin-1~3)，每档持续到这个时刻（毫秒） */
const PINYIN_STAGES = [140, 300, 460]
const PINYIN_NAMES = PINYIN_STAGES.map((_, i) => `ink-pinyin-${i + 1}`)
const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS

const quiet = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches

export const typingFeedback = ViewPlugin.fromClass(
  class {
    fresh: Fresh[] = []
    decorations: DecorationSet = Decoration.none
    /** 输入法开始组字时光标的位置，跟着文档改动一起挪 */
    composeFrom: number | null = null
    /** 组字中刚敲出的拼音：DOM 上的范围和敲下的时刻 */
    pinyin: { range: globalThis.Range; t: number }[] = []
    frame = 0

    constructor(readonly view: EditorView) {}

    update(u: ViewUpdate) {
      let added = false
      const typed: { from: number; to: number }[] = []
      for (const tr of u.transactions) {
        if (!tr.docChanged) continue
        this.fresh = this.fresh.map((f) => ({ ...f, from: tr.changes.mapPos(f.from, 1), to: tr.changes.mapPos(f.to, -1) })).filter((f) => f.to > f.from)
        if (this.composeFrom !== null) this.composeFrom = tr.changes.mapPos(this.composeFrom, -1)
        typed.forEach((r, i) => (typed[i] = { from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }))
        if (tr.isUserEvent('input.type.compose')) {
          // 多敲了一个拼音字母才算；退格删拼音不给反馈
          tr.changes.iterChanges((fa, ta, from, to, text) => {
            if (to - from > ta - fa && /\S/.test(text.toString())) typed.push({ from, to })
          })
          continue
        }
        if (!tr.isUserEvent('input.type')) continue
        tr.changes.iterChangedRanges((_fa, _ta, from, to) => {
          if (/\S/.test(tr.newDoc.sliceString(from, to))) {
            this.fresh.push({ from, to, t: Date.now() })
            added = true
          }
        })
      }
      if (typed.length) this.glowPinyin(typed)
      // 组字中不动装饰：重画那一行会把输入法的候选打断
      if (u.view.composing) {
        this.decorations = this.decorations.map(u.changes)
        return
      }
      if (added || u.docChanged || this.fresh.length) this.build()
      if (added) this.sparkle()
    }

    /** 每次重算都按「已经过去多久」给负的 animation-delay：整行重画时动画接着播，不会从头再闪一遍 */
    build() {
      const now = Date.now()
      this.fresh = this.fresh.filter((f) => now - f.t < SETTLE)
      const ranges: Range<Decoration>[] = this.fresh
        .slice()
        .sort((a, b) => a.from - b.from)
        .map((f) => Decoration.mark({ class: 'ink-settle', attributes: { style: `animation-delay:-${now - f.t}ms` } }).range(f.from, f.to))
      this.decorations = Decoration.set(ranges, true)
    }

    /** 等编辑器把拼音写进 DOM 后，按位置取出对应的文字范围交给 Highlight，再飘一粒星点 */
    glowPinyin(typed: { from: number; to: number }[]) {
      this.sparkle()
      if (!canHighlight || quiet()) return
      this.view.requestMeasure({
        read: () => null,
        write: (_, v) => {
          const now = Date.now()
          for (const { from, to } of typed) {
            if (to > v.state.doc.length) continue
            const a = v.domAtPos(from, 1)
            const b = v.domAtPos(to, -1)
            const range = document.createRange()
            try {
              range.setStart(a.node, a.offset)
              range.setEnd(b.node, b.offset)
            } catch {
              continue
            }
            if (!range.collapsed) this.pinyin.push({ range, t: now })
          }
          if (this.pinyin.length && !this.frame) this.frame = requestAnimationFrame(this.tick)
        },
      })
    }

    /** 每帧按敲下多久把拼音分到三档里，过了最后一档就不再画 */
    tick = () => {
      const now = Date.now()
      this.pinyin = this.pinyin.filter((p) => now - p.t < PINYIN_STAGES[PINYIN_STAGES.length - 1])
      PINYIN_NAMES.forEach((name, i) => {
        const ranges = this.pinyin.filter((p) => now - p.t < PINYIN_STAGES[i] && (i === 0 || now - p.t >= PINYIN_STAGES[i - 1])).map((p) => p.range)
        if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges))
        else CSS.highlights.delete(name)
      })
      this.frame = this.pinyin.length ? requestAnimationFrame(this.tick) : 0
    }

    clearPinyin() {
      this.pinyin = []
      if (this.frame) cancelAnimationFrame(this.frame)
      this.frame = 0
      if (canHighlight) PINYIN_NAMES.forEach((name) => CSS.highlights.delete(name))
    }

    destroy() {
      this.clearPinyin()
    }

    compositionStart() {
      this.composeFrom = this.view.state.selection.main.from
    }

    /** 上屏那一刻编辑器还没把最终文字写进文档，等它落定再标 */
    compositionEnd() {
      const from = this.composeFrom
      this.composeFrom = null
      // 拼音换成了汉字，原来的范围已经对不上，交给下面的上屏效果
      this.clearPinyin()
      if (from === null) return
      setTimeout(() => {
        const to = this.view.state.selection.main.head
        if (this.view.composing || to <= from || !/\S/.test(this.view.state.sliceDoc(from, to))) return
        this.fresh.push({ from, to, t: Date.now() })
        this.view.dispatch({})
        this.sparkle()
      }, 30)
    }

    /** 光标处飘起一粒星点；量坐标要等编辑器排完版 */
    sparkle() {
      if (quiet()) return
      this.view.requestMeasure({
        read: (v) => {
          const at = v.coordsAtPos(v.state.selection.main.head, -1)
          return at && { at, box: v.dom.getBoundingClientRect() }
        },
        write: (m, v) => {
          if (!m) return
          const dot = document.createElement('span')
          dot.className = 'ink-dust'
          dot.setAttribute('aria-hidden', 'true')
          dot.style.left = `${m.at.left - m.box.left}px`
          dot.style.top = `${m.at.top - m.box.top + (m.at.bottom - m.at.top) * 0.15}px`
          dot.style.setProperty('--dx', `${(Math.random() * 10 - 5).toFixed(1)}px`)
          dot.addEventListener('animationend', () => dot.remove())
          v.dom.appendChild(dot)
        },
      })
    }
  },
  {
    decorations: (p) => p.decorations,
    eventHandlers: {
      compositionstart() {
        this.compositionStart()
      },
      compositionend() {
        this.compositionEnd()
      },
    },
  },
)
