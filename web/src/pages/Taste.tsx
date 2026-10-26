import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { ArrowLeft, ArrowUpRight, ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TagInput } from '../components/TagInput'
import { Confirm, Sheet, Tabs, useSpotlight } from '../components/ui'
import { api, uploadWithThumb, type TasteImage, type TasteItem } from '../lib/api'
import { cnDate, dateKey } from '../lib/date'
import { renderMarkdown } from '../lib/markdown'
import { EASE_OUT, SPRING_LAYOUT, SPRING_PANEL } from '../lib/motion'
import { toast } from '../lib/store'
import './taste.css'

type TypeFilter = 'all' | 'link' | 'note'
interface Facets {
  types: { link: number; note: number }
  tags: { name: string; count: number }[]
  categories: { name: string; count: number }[]
  total: number
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function Card({ item, index, onOpen }: { item: TasteItem; index: number; onOpen: () => void }) {
  const ref = useSpotlight<HTMLElement>()
  const cover = item.images[0]
  return (
    <motion.article
      ref={ref}
      layoutId={`taste-${item.id}`}
      layout
      className="t-card glass spot"
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      tabIndex={0}
      role="button"
      aria-label={item.title || '一条收藏'}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
      transition={{ ...SPRING_LAYOUT, opacity: { duration: 0.5, delay: Math.min(index * 0.04, 0.4) }, y: { duration: 0.6, ease: EASE_OUT, delay: Math.min(index * 0.04, 0.4) } }}
    >
      {cover && (
        <motion.div layout="position" className="t-cover" style={{ aspectRatio: cover.width && cover.height ? `${cover.width} / ${cover.height}` : undefined }}>
          <img src={cover.thumb || cover.url} alt="" loading="lazy" decoding="async" onLoad={(e) => e.currentTarget.classList.add('is-loaded')} />
          {item.images.length > 1 && <span className="t-count">{item.images.length}</span>}
        </motion.div>
      )}
      <motion.div layout="position" className="t-body">
        {item.type === 'note' && !item.title ? null : <h3 className="t-title">{item.title || host(item.url) || '未命名'}</h3>}
        {item.subtitle && <p className="t-sub">{item.subtitle}</p>}
        {item.note && <p className={`t-note ${item.type === 'note' ? 't-note--big' : ''}`}>{item.note.replace(/[#>*`_]/g, '').slice(0, 220)}</p>}
        <footer className="t-foot">
          {item.url && <span className="t-host">{host(item.url)}</span>}
          {item.category && <span className="t-cat">{item.category}</span>}
          {item.tags.slice(0, 3).map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </footer>
      </motion.div>
    </motion.article>
  )
}

function Detail({ item, onClose, onEdit, onDelete }: { item: TasteItem; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const [i, setI] = useState(0)
  const img = item.images[i]
  return (
    <div className="t-detail">
      {img && (
        <div className="t-gallery">
          <AnimatePresence mode="wait" initial={false}>
            <motion.img key={img.url} src={img.url} alt={img.name || ''} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
          </AnimatePresence>
          {item.images.length > 1 && (
            <div className="t-thumbs">
              {item.images.map((m, k) => (
                <button key={m.url} className={`t-thumb ${k === i ? 't-thumb--on' : ''}`} onClick={() => setI(k)} aria-label={`第 ${k + 1} 张`}>
                  <img src={m.thumb || m.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="t-detail-body">
        <div className="t-detail-top">
          <button className="icon-btn" onClick={onClose} aria-label="返回">
            <ArrowLeft size={18} />
          </button>
          <span className="faint">{cnDate(dateKey(new Date(item.created_at)), true)}收藏</span>
          <span className="editor-spacer" />
          <button className="icon-btn" onClick={onEdit} aria-label="编辑">
            <Pencil size={16} />
          </button>
          <button className="icon-btn" onClick={onDelete} aria-label="删除">
            <Trash2 size={16} />
          </button>
        </div>
        {item.title && <h2 className="t-detail-title">{item.title}</h2>}
        {item.subtitle && <p className="t-sub">{item.subtitle}</p>}
        {item.url && (
          <a className="btn t-open" href={item.url} target="_blank" rel="noreferrer noopener">
            打开 {host(item.url)}
            <ArrowUpRight size={14} />
          </a>
        )}
        {item.note && <div className="prose t-detail-note" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.note) }} />}
        <footer className="t-foot">
          {item.category && <span className="t-cat">{item.category}</span>}
          {item.tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </footer>
      </div>
    </div>
  )
}

interface Draft {
  type: 'link' | 'note'
  title: string
  subtitle: string
  url: string
  category: string
  tags: string[]
  note: string
  images: TasteImage[]
}

const blank: Draft = { type: 'link', title: '', subtitle: '', url: '', category: '', tags: [], note: '', images: [] }

function Form({ initial, categories, onDone }: { initial: TasteItem | null; categories: string[]; onDone: (saved?: TasteItem) => void }) {
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(() => (initial ? { ...blank, ...initial } : blank))
  const [busy, setBusy] = useState(0)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))

  const addFiles = async (files: File[]) => {
    for (const f of files.filter((f) => f.type.startsWith('image/'))) {
      setBusy((n) => n + 1)
      try {
        const res = await uploadWithThumb(f, f.name)
        const dims = await new Promise<{ width: number; height: number }>((ok) => {
          const im = new Image()
          im.onload = () => ok({ width: im.naturalWidth, height: im.naturalHeight })
          im.onerror = () => ok({ width: 0, height: 0 })
          im.src = res.url
        })
        setD((x) => ({ ...x, images: [...x.images, { ...res, name: f.name, ...dims }] }))
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setBusy((n) => n - 1)
      }
    }
  }

  const save = useMutation({
    mutationFn: () => (initial ? api.patch<TasteItem>(`/api/taste/${initial.id}`, d) : api.post<TasteItem>('/api/taste', d)),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['taste'] })
      void qc.invalidateQueries({ queryKey: ['taste-facets'] })
      toast(initial ? '已保存修改' : '已收藏')
      onDone(saved)
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  return (
    <form
      className="t-form"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files]
        if (files.length) {
          e.preventDefault()
          void addFiles(files)
        }
      }}
    >
      <Tabs
        value={d.type}
        onChange={(type) => set({ type })}
        label="类型"
        options={[
          { value: 'link', label: '链接或作品' },
          { value: 'note', label: '一个想法' },
        ]}
      />
      <div className="t-form-grid">
        <label>
          <span className="label">{d.type === 'note' ? '题目（可不填）' : '名字'}</span>
          <input className="field" value={d.title} onChange={(e) => set({ title: e.target.value })} data-autofocus placeholder={d.type === 'note' ? '' : '一本书、一部片、一首歌、一个网页'} />
        </label>
        <label>
          <span className="label">作者或出处</span>
          <input className="field" value={d.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
        </label>
        {d.type === 'link' && (
          <label className="t-span">
            <span className="label">链接</span>
            <input className="field" value={d.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" inputMode="url" />
          </label>
        )}
        <label>
          <span className="label">分类</span>
          <input className="field" value={d.category} list="taste-cats" onChange={(e) => set({ category: e.target.value })} placeholder="书 / 影 / 音 / 游戏…" />
          <datalist id="taste-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <div>
          <span className="label">标签</span>
          <TagInput tags={d.tags} onChange={(tags) => set({ tags })} label="" />
        </div>
        <label className="t-span">
          <span className="label">{d.type === 'note' ? '想法' : '为什么喜欢'}</span>
          <textarea className="field" rows={d.type === 'note' ? 7 : 4} value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder="支持 Markdown" />
        </label>
      </div>
      <div>
        <span className="label">图片（第一张是封面，可以直接粘贴）</span>
        <LayoutGroup>
          <div className="t-imgs">
            <AnimatePresence initial={false}>
              {d.images.map((m, k) => (
                <motion.div key={m.url} layout className="t-img" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={SPRING_PANEL}>
                  <img src={m.thumb || m.url} alt="" />
                  {k === 0 && <span className="t-img-cover">封面</span>}
                  <div className="t-img-tools">
                    {k > 0 && (
                      <button type="button" onClick={() => set({ images: [m, ...d.images.filter((x) => x !== m)] })} title="设为封面">
                        <ArrowLeft size={13} />
                      </button>
                    )}
                    <button type="button" onClick={() => set({ images: d.images.filter((x) => x !== m) })} title="移除">
                      <X size={13} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <label className="t-img t-img-add">
              <ImagePlus size={20} />
              <span>{busy ? `上传中 ${busy}` : '添加'}</span>
              <input type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles([...(e.target.files || [])])} />
            </label>
          </div>
        </LayoutGroup>
      </div>
      <div className="t-form-foot">
        <button type="button" className="btn btn--ghost" onClick={() => onDone()}>
          取消
        </button>
        <button className="btn btn--primary" disabled={save.isPending || busy > 0}>
          {initial ? '保存修改' : '收藏'}
        </button>
      </div>
    </form>
  )
}

export default function Taste() {
  const qc = useQueryClient()
  const [type, setType] = useState<TypeFilter>('all')
  const [tag, setTag] = useState('')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState<TasteItem | null>(null)
  const [editing, setEditing] = useState<TasteItem | null | 'new'>(null)
  const [deleting, setDeleting] = useState<TasteItem | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220)
    return () => clearTimeout(t)
  }, [q])

  const params = new URLSearchParams()
  if (type !== 'all') params.set('type', type)
  if (tag) params.set('tag', tag)
  if (cat) params.set('category', cat)
  if (debounced) params.set('q', debounced)
  const { data: items, isLoading } = useQuery({
    queryKey: ['taste', params.toString()],
    queryFn: () => api.get<TasteItem[]>(`/api/taste?${params}`),
    placeholderData: (prev) => prev,
  })
  const { data: facets } = useQuery({ queryKey: ['taste-facets'], queryFn: () => api.get<Facets>('/api/taste/facets') })

  const mainRef = useRef<HTMLDivElement>(null)
  // 收藏少的时候不要摆出一排空列
  const columns = Math.max(1, Math.min(useColumns(mainRef), items?.length || 3))
  const cols = useMemo(() => {
    // 按高度估算分到最矮的一列，保持阅读顺序从左到右
    const out: { item: TasteItem; index: number }[][] = Array.from({ length: columns }, () => [])
    const h = Array(columns).fill(0)
    ;(items || []).forEach((item, index) => {
      const c = h.indexOf(Math.min(...h))
      out[c].push({ item, index })
      const im = item.images[0]
      h[c] += (im ? (im.height && im.width ? Math.min(1.6, im.height / im.width) : 0.75) * 300 : 0) + 90 + Math.min(item.note.length, 220) * 0.5
    })
    return out
  }, [items, columns])

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/taste/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['taste'] })
      void qc.invalidateQueries({ queryKey: ['taste-facets'] })
      setOpen(null)
      toast('已删除')
    },
  })

  return (
    <div className="page taste">
      <div className="taste-layout">
        {/* 宽屏时这一栏贴在左边：标题、搜索、筛选都在这里，右边整片留给收藏 */}
        <aside className="t-side">
          <header className="t-head rise">
            <h1 className="page-title">品味库</h1>
            <p className="page-sub">{facets ? `${facets.total} 件喜欢的东西` : ' '}</p>
          </header>
          <div className="t-tools rise">
            <label className="t-search">
              <Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名字、想法、标签" aria-label="搜索收藏" />
            </label>
            <button className="btn btn--primary" onClick={() => setEditing('new')}>
              <Plus size={16} />
              收藏
            </button>
          </div>
          <div className="t-filters rise">
            <Tabs
              value={type}
              onChange={setType}
              label="类型"
              options={[
                { value: 'all', label: '全部', count: facets?.total },
                { value: 'link', label: '链接与作品', count: facets?.types.link },
                { value: 'note', label: '想法', count: facets?.types.note },
              ]}
            />
            {!!facets?.categories.length && (
              <div className="t-chips" role="group" aria-label="分类">
                {facets.categories.map((c) => (
                  <button key={c.name} className={`chip ${cat === c.name ? 'chip--on' : ''}`} onClick={() => setCat(cat === c.name ? '' : c.name)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {!!facets?.tags.length && (
              <div className="t-chips" role="group" aria-label="标签">
                {facets.tags.slice(0, 24).map((t) => (
                  <button key={t.name} className={`chip ${tag === t.name ? 'chip--on' : ''}`} onClick={() => setTag(tag === t.name ? '' : t.name)}>
                    #{t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="t-main" ref={mainRef}>
          {isLoading ? (
            <div className="t-grid" style={{ ['--cols' as string]: columns }}>
              {Array.from({ length: columns }, (_, i) => (
                <div key={i} className="t-col">
                  <div className="skeleton" style={{ height: 260 }} />
                  <div className="skeleton" style={{ height: 160 }} />
                </div>
              ))}
            </div>
          ) : !items?.length ? (
            <div className="glass t-empty">
              {facets?.total ? (
                <p>没有符合条件的收藏。</p>
              ) : (
                <>
                  <p className="t-empty-title">收藏让你停下来的东西</p>
                  <p className="muted">一本书、一首歌、一句话、一个网页。点「收藏」放进来，以后在这里重逢。</p>
                  <button className="btn btn--primary" onClick={() => setEditing('new')}>
                    <Plus size={16} />
                    收藏第一件
                  </button>
                </>
              )}
            </div>
          ) : (
            <LayoutGroup>
              <div className="t-grid" style={{ ['--cols' as string]: columns }}>
                {cols.map((col, ci) => (
                  <div key={ci} className="t-col">
                    <AnimatePresence mode="popLayout">
                      {col.map(({ item, index }) =>
                        open?.id === item.id ? <div key={item.id} className="t-placeholder" /> : <Card key={item.id} item={item} index={index} onOpen={() => setOpen(item)} />,
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
              <Sheet open={!!open} onClose={() => setOpen(null)} width={880} layoutId={open ? `taste-${open.id}` : undefined}>
                {open && (
                  <Detail
                    item={open}
                    onClose={() => setOpen(null)}
                    onEdit={() => {
                      setEditing(open)
                      setOpen(null)
                    }}
                    onDelete={() => setDeleting(open)}
                  />
                )}
              </Sheet>
            </LayoutGroup>
          )}

        </div>
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? '收藏一件东西' : '编辑收藏'} width={720}>
        {editing !== null && <Form initial={editing === 'new' ? null : editing} categories={facets?.categories.map((c) => c.name) || []} onDone={() => setEditing(null)} />}
      </Sheet>
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除这条收藏？"
        body="只有它用到的图片也会一起删掉。"
        confirmText="删除"
        danger
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  )
}

/** 列数跟着收藏区的实际宽度走：每列不窄于 320px，最多 7 列 */
function useColumns(ref: RefObject<HTMLElement | null>) {
  const [n, setN] = useState(() => (innerWidth < 640 ? 1 : innerWidth < 1100 ? 2 : 3))
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setN(Math.max(1, Math.min(7, Math.floor((e.contentRect.width + 22) / (320 + 22))))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return n
}
