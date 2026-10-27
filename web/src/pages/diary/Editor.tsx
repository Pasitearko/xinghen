// 正文编辑：CodeMirror，所见即所得地显示 Markdown（粗体、斜体、引用、标题、列表、图片），存下来的仍是纯文本。
// 一条轻量工具栏，粘贴/拖入图片直接上传；列表、引用里回车自动续上符号。
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdownLanguage } from '@codemirror/lang-markdown'
import { Annotation, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { Bold, Heading2, ImagePlus, Italic, List, ListChecks, Minus, Quote } from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { uploadImage } from '../../lib/api'
import { toast } from '../../lib/store'
import { livePreview } from './livePreview'

type Action = { icon: typeof Bold; label: string; run: (sel: string) => { text: string; caret?: number }; line?: boolean }

const ACTIONS: Action[] = [
  { icon: Heading2, label: '小标题', line: true, run: (s) => ({ text: `## ${s}` }) },
  { icon: Bold, label: '加粗', run: (s) => ({ text: `**${s || '文字'}**`, caret: s ? undefined : 2 }) },
  { icon: Italic, label: '斜体', run: (s) => ({ text: `*${s || '文字'}*`, caret: s ? undefined : 1 }) },
  { icon: Quote, label: '引用', line: true, run: (s) => ({ text: s.split('\n').map((l) => `> ${l}`).join('\n') }) },
  { icon: List, label: '列表', line: true, run: (s) => ({ text: s.split('\n').map((l) => `- ${l}`).join('\n') }) },
  { icon: ListChecks, label: '待办', line: true, run: (s) => ({ text: s.split('\n').map((l) => `- [ ] ${l}`).join('\n') }) },
  { icon: Minus, label: '分隔线', line: true, run: () => ({ text: '\n---\n' }) },
]

/** 外部（换篇、读到别的版本）改写正文时打上这个标记，不再回传 onChange */
const External = Annotation.define<boolean>()

export interface EditorHandle {
  /** 在正文末尾另起一段写入，光标停在它下面 */
  appendBlock: (text: string) => void
}

function insert(view: EditorView, text: string, opts: { line?: boolean; caret?: number } = {}) {
  const { from, to } = view.state.selection.main
  const prefix = opts.line && from > 0 && view.state.sliceDoc(from - 1, from) !== '\n' ? '\n' : ''
  const start = from + prefix.length
  const pos = opts.caret !== undefined ? start + opts.caret : start + text.length
  view.dispatch({
    changes: { from, to, insert: prefix + text },
    selection: { anchor: pos, head: opts.caret !== undefined ? pos + 2 : pos },
    scrollIntoView: true,
  })
  view.focus()
}

function apply(view: EditorView, act: Action) {
  const { from, to } = view.state.selection.main
  const out = act.run(view.state.sliceDoc(from, to))
  insert(view, out.text, { line: act.line, caret: out.caret })
  return true
}

export function Editor({
  value,
  onChange,
  font,
  onSave,
  ref,
}: {
  value: string
  onChange: (v: string) => void
  font: 'serif' | 'kai'
  onSave: () => void
  ref?: Ref<EditorHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // 编辑器里当前正文的最后一份字符串（自己输入的和外部换进来的都记），用来跳过重复比较
  const emitted = useRef(value)
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  // 回调放进 ref，编辑器只建一次
  const cb = useRef({ onChange, onSave, upload: async (_: File[]) => {} })
  cb.current.onChange = onChange
  cb.current.onSave = onSave

  const upload = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    setUploading((n) => n + imgs.length)
    for (const f of imgs) {
      try {
        const res = await uploadImage(f, 'diary', f.name)
        if (view.current) insert(view.current, `![${f.name.replace(/\.\w+$/, '') || '图片'}](${res.url})\n`, { line: true })
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }
  cb.current.upload = upload

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          Prec.high(
            keymap.of([
              { key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave(), true) },
              { key: 'Mod-b', run: (v) => apply(v, ACTIONS[1]) },
              { key: 'Mod-i', run: (v) => apply(v, ACTIONS[2]) },
              // 列表、待办、引用里回车自动续上符号，空项回车结束
              { key: 'Enter', run: insertNewlineContinueMarkup },
              { key: 'Backspace', run: deleteMarkupBackward },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // 只要 Markdown 本身（含 GFM 的待办、删除线），不带 HTML、代码高亮那一大套
          markdownLanguage,
          livePreview,
          EditorView.lineWrapping,
          placeholder('今天发生了什么，想到了什么……'),
          EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': '正文' }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((t) => t.annotation(External))) return
            emitted.current = u.state.doc.toString()
            cb.current.onChange(emitted.current)
          }),
          EditorView.domEventHandlers({
            paste(e) {
              const files = [...(e.clipboardData?.files || [])]
              if (!files.some((f) => f.type.startsWith('image/'))) return false
              e.preventDefault()
              void cb.current.upload(files)
              return true
            },
            // 拖进来的文件交给外层上传，别让编辑器把图片当文字读进来
            drop(e, v) {
              if (!e.dataTransfer?.files.length) return false
              e.preventDefault()
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos !== null) v.dispatch({ selection: { anchor: pos } })
              setDragging(false)
              void cb.current.upload([...e.dataTransfer.files])
              return true
            },
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  // 换了一篇或用了另一个窗口的版本：整篇替换，光标尽量留在原处
  useEffect(() => {
    const v = view.current
    // 自己刚发出去的内容又传回来（每次按键都会），不用再整篇比较
    if (!v || value === emitted.current || v.state.doc.toString() === value) return
    const head = Math.min(v.state.selection.main.head, value.length)
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, selection: { anchor: head }, annotations: External.of(true) })
    emitted.current = value
  }, [value])

  useImperativeHandle(ref, () => ({
    appendBlock(text) {
      const v = view.current
      if (!v) return
      const doc = v.state.doc.toString()
      const keep = doc.replace(/\s+$/, '').length
      const insertText = `${keep ? '\n\n' : ''}${text}\n\n`
      v.dispatch({ changes: { from: keep, to: doc.length, insert: insertText }, selection: { anchor: keep + insertText.length }, scrollIntoView: true })
      v.focus()
    },
  }))

  return (
    <div
      className={`editor ${dragging ? 'editor--drag' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false)
        // 落在正文里的已经由编辑器按落点上传过了
        if (!e.defaultPrevented && e.dataTransfer.files.length) {
          e.preventDefault()
          void upload([...e.dataTransfer.files])
        }
      }}
    >
      <div className="editor-bar" role="toolbar" aria-label="格式">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            className="icon-btn icon-btn--sm"
            // 按下时不抢焦点，选中的文字还在
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => view.current && apply(view.current, a)}
            title={a.label}
            aria-label={a.label}
          >
            <a.icon size={15} />
          </button>
        ))}
        <label className="icon-btn icon-btn--sm" title="插入图片（也可以直接粘贴或拖进来）">
          <ImagePlus size={15} />
          <input type="file" accept="image/*" multiple hidden onChange={(e) => void upload([...(e.target.files || [])])} />
        </label>
        {uploading > 0 && <span className="editor-up faint">正在上传 {uploading} 张图…</span>}
      </div>
      <div ref={host} className={`editor-area ${font === 'kai' ? 'kai' : ''}`} />
    </div>
  )
}
