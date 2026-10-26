// 所见即所得：正文仍然存成 Markdown，但写的时候粗体就是粗体、引用就是引用。
// 光标不在的地方把 ** # > - 这些符号藏起来，只留效果；光标移进去，符号淡淡地露出来，方便改。
import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

const hide = Decoration.replace({})
const dim = Decoration.mark({ class: 'md-mark' })
const line = (cls: string) => Decoration.line({ class: cls })

const INLINE: Record<string, string> = {
  Emphasis: 'md-em',
  StrongEmphasis: 'md-strong',
  Strikethrough: 'md-strike',
  InlineCode: 'md-code',
  Link: 'md-link',
}
/** 这些符号属于哪个行内元素：光标碰到那个元素才露出来 */
const INLINE_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'URL', 'LinkTitle'])

class Bullet extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'md-bullet'
    s.textContent = '•'
    return s
  }
}

class Check extends WidgetType {
  constructor(readonly done: boolean) {
    super()
  }
  eq(o: Check) {
    return o.done === this.done
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'md-check'
    box.checked = this.done
    box.setAttribute('aria-label', this.done ? '已完成' : '未完成')
    // 点一下勾选或取消，改的是正文里的 [ ] / [x]
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(box)
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: this.done ? '[ ]' : '[x]' } })
    })
    return box
  }
  ignoreEvent() {
    return false
  }
}

class Image extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super()
  }
  eq(o: Image) {
    return o.src === this.src && o.alt === this.alt
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = 'md-img'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.decoding = 'async'
    // 图片所在这一行的高度凑成整数格，后面的字才能继续落在横线上
    img.onload = () => {
      const rule = parseFloat(getComputedStyle(view.contentDOM).lineHeight) || 33
      wrap.style.height = `${Math.ceil((img.getBoundingClientRect().height + 12) / rule) * rule}px`
      requestAnimationFrame(() => {
        const row = wrap.closest('.cm-line')?.getBoundingClientRect().height
        if (row) wrap.style.height = `${parseFloat(wrap.style.height) + Math.ceil(row / rule - 0.02) * rule - row}px`
        view.requestMeasure()
      })
    }
    wrap.append(img)
    return wrap
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view
  const focused = view.hasFocus
  const sel = state.selection.ranges
  // 没在写的时候整篇都按效果显示；在写时，光标所在的行和元素露出符号
  const activeLines = new Set<number>()
  if (focused) {
    for (const r of sel) {
      for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) activeLines.add(n)
    }
  }
  const lineActive = (pos: number) => activeLines.has(state.doc.lineAt(pos).number)
  const touched = (n: SyntaxNode) => focused && sel.some((r) => r.from <= n.to && r.to >= n.from)
  const out: Range<Decoration>[] = []
  const eachLine = (from: number, to: number, deco: Decoration) => {
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) out.push(deco.range(state.doc.line(n).from))
  }
  // 把符号连同后面的一个空格一起藏起来
  const hideWithSpace = (from: number, to: number) => {
    const end = state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to
    if (end > from) out.push(hide.range(from, end))
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(ref) {
        const name = ref.name
        const node = ref.node
        const heading = /^ATXHeading(\d)$/.exec(name)
        if (heading) {
          out.push(line(`md-h md-h${Math.min(3, Number(heading[1]))}`).range(state.doc.lineAt(node.from).from))
        } else if (name === 'HeaderMark') {
          if (lineActive(node.from)) out.push(dim.range(node.from, node.to))
          else hideWithSpace(node.from, node.to)
        } else if (name === 'Blockquote') {
          if (node.parent?.name !== 'Blockquote') eachLine(node.from, node.to, line('md-quote'))
        } else if (name === 'QuoteMark') {
          if (lineActive(node.from)) out.push(dim.range(node.from, node.to))
          else hideWithSpace(node.from, node.to)
        } else if (name === 'FencedCode') {
          eachLine(node.from, node.to, line('md-codeblock'))
        } else if (name === 'HorizontalRule') {
          if (lineActive(node.from)) out.push(dim.range(node.from, node.to))
          else {
            out.push(line('md-hr').range(state.doc.lineAt(node.from).from))
            out.push(hide.range(node.from, node.to))
          }
        } else if (name === 'ListMark') {
          const item = node.parent
          const task = item?.getChild('Task')
          if (item?.parent?.name !== 'BulletList' || lineActive(node.from)) out.push(dim.range(node.from, node.to))
          else if (task) hideWithSpace(node.from, node.to)
          else out.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to))
        } else if (name === 'TaskMarker') {
          const done = /x/i.test(state.sliceDoc(node.from, node.to))
          out.push(Decoration.replace({ widget: new Check(done) }).range(node.from, node.to))
          if (done && node.parent) out.push(Decoration.mark({ class: 'md-done' }).range(node.to, node.parent.to))
        } else if (name === 'Image') {
          if (touched(node)) return
          const url = node.getChild('URL')
          const text = state.sliceDoc(node.from, node.to)
          const alt = /^!\[([^\]]*)\]/.exec(text)?.[1] || ''
          if (url) out.push(Decoration.replace({ widget: new Image(state.sliceDoc(url.from, url.to), alt) }).range(node.from, node.to))
          return false
        } else if (INLINE[name]) {
          if (node.to > node.from) out.push(Decoration.mark({ class: INLINE[name] }).range(node.from, node.to))
        } else if (INLINE_MARKS.has(name)) {
          const owner = node.parent
          if (!owner || !(owner.name in INLINE)) {
            if (node.to > node.from) out.push(dim.range(node.from, node.to))
          } else if (touched(owner)) out.push(dim.range(node.from, node.to))
          else out.push(hide.range(node.from, node.to))
        }
      },
    })
  }
  return Decoration.set(out, true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

