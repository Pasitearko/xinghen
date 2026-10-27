import { motion } from 'motion/react'
import { Check as CheckIcon, ImagePlus, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, uploadImage, type NewsSource, type Profile, type Wallpaper } from '../lib/api'
import { timeAgo } from '../lib/date'
import { SPRING_LAYOUT } from '../lib/motion'
import { loadTracks, player } from '../lib/player'
import { prefs, resolvedTheme, switchTheme, toast, usePrefs, useStore, type Ambient, type ThemePref } from '../lib/store'
import { ContactLinks } from './Signature'
import { Sheet, Switch, Tabs } from './ui'
import './settings.css'

const WALL_NAMES: Record<string, string> = {
  'cn-courtyard': '中式天井',
  'feixing-day': '白色相簿',
  'atri-flower': 'ATRI 花海',
  'cloud-sky': '云与天空',
  'cn-frame': '中式边框',
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <p className="set-label">{label}</p>
        {hint && <p className="set-hint">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function ProfileSection() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['profile'], queryFn: () => api.get<Profile>('/api/profile') })
  const [form, setForm] = useState<Profile>({ name: '', motto: '', avatar_url: '' })
  useEffect(() => {
    if (data) setForm(data)
  }, [data])
  const save = useMutation({
    mutationFn: () => api.put<Profile>('/api/profile', form),
    onSuccess: (p) => {
      qc.setQueryData(['profile'], p)
      toast('已保存')
    },
  })
  const dirty = data && (data.name !== form.name || data.motto !== form.motto)
  return (
    <section className="set-sec">
      <h3 className="set-title">关于你</h3>
      <label className="set-field">
        <span className="label">名字（首页会这样称呼你）</span>
        <input className="field" value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="set-field">
        <span className="label">一句话（显示在问候下面）</span>
        <input className="field" value={form.motto} maxLength={80} onChange={(e) => setForm({ ...form, motto: e.target.value })} />
      </label>
      {dirty && (
        <motion.button className="btn btn--primary btn--sm" onClick={() => save.mutate()} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          保存
        </motion.button>
      )}
    </section>
  )
}

function WallpaperSection() {
  const qc = useQueryClient()
  const theme = usePrefs((p) => resolvedTheme(p))
  const dim = usePrefs((p) => p.wallpaperDim)
  const key = theme === 'night' ? 'dark' : 'light'
  const { data } = useQuery({
    queryKey: ['wallpapers'],
    queryFn: () => api.get<{ items: Wallpaper[]; selected: { dark: string; light: string } }>('/api/wallpapers'),
  })
  const select = useMutation({
    mutationFn: (id: string) => api.put<{ dark: string; light: string }>('/api/wallpapers/selected', { [key]: id }),
    onSuccess: (sel) => qc.setQueryData(['wallpapers'], (d: typeof data) => (d ? { ...d, selected: sel } : d)),
  })
  const upload = useMutation({
    mutationFn: (f: File) => uploadImage(f, 'wallpaper', f.name),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['wallpapers'] })
      select.mutate(`upload:${r.filename}`)
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (filename: string) => api.del(`/api/wallpapers/upload/${filename}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallpapers'] }),
  })
  const current = data?.selected[key] || 'sky'
  return (
    <section className="set-sec">
      <h3 className="set-title">{theme === 'night' ? '夜间' : '晨间'}壁纸</h3>
      <div className="walls">
        <button className={`wall wall--sky ${current === 'sky' ? 'wall--on' : ''}`} onClick={() => select.mutate('sky')}>
          <span>只要天空</span>
          {current === 'sky' && <motion.span layoutId="wall-on" className="wall-ring" transition={SPRING_LAYOUT} />}
        </button>
        {data?.items.map((w) => (
          <div key={w.id} className={`wall ${current === w.id ? 'wall--on' : ''}`}>
            <button className="wall-pick" onClick={() => select.mutate(w.id)} aria-label={WALL_NAMES[w.name] || w.name}>
              <img src={w.url} alt="" loading="lazy" decoding="async" />
              <span className="wall-name">{WALL_NAMES[w.name] || w.name.replace(/^wallpaper-\d+-/, '')}</span>
            </button>
            {w.kind === 'upload' && (
              <button className="wall-del" onClick={() => remove.mutate(w.id.slice(7))} aria-label="删除这张壁纸">
                <Trash2 size={12} />
              </button>
            )}
            {current === w.id && <motion.span layoutId="wall-on" className="wall-ring" transition={SPRING_LAYOUT} />}
          </div>
        ))}
        <label className="wall wall--add">
          <ImagePlus size={18} />
          <span>{upload.isPending ? '上传中…' : '用自己的图'}</span>
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        </label>
      </div>
      {current !== 'sky' && (
        <Row label="壁纸遮罩" hint="越往右，壁纸越暗，文字越清楚">
          <input className="set-range" type="range" min={0} max={0.9} step={0.01} value={dim} onChange={(e) => prefs.set({ wallpaperDim: Number(e.target.value) })} style={{ ['--p' as string]: `${(dim / 0.9) * 100}%` }} />
        </Row>
      )}
    </section>
  )
}

function NewsSection() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['news-sources'], queryFn: () => api.get<NewsSource[]>('/api/news/sources') })
  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api.patch<NewsSource[]>(`/api/news/sources/${key}`, { enabled }),
    onSuccess: (list) => {
      qc.setQueryData(['news-sources'], list)
      void qc.invalidateQueries({ queryKey: ['news'] })
    },
  })
  const groups: { key: NewsSource['category']; label: string }[] = [
    { key: 'official', label: '官方' },
    { key: 'media', label: '媒体' },
    { key: 'community', label: '社区' },
    { key: 'aggregate', label: '聚合' },
  ]
  return (
    <section className="set-sec">
      <h3 className="set-title">资讯来源</h3>
      <p className="set-hint">只收 OpenAI、Anthropic、DeepSeek 的模型发布与升级，Codex、Claude、DeepSeek 的产品与版本动态，以及三家官网动态。媒体评测、教程、传闻和融资等杂讯不收。同一事件合并报道，优先展示官方原文，可同时关联多家并在对应栏目查看。只显示最近 24 小时，开机后每 3 小时更新一次。</p>
      {groups.map((g) => (
        <div key={g.key} className="src-group">
          <p className="src-cat">{g.label}</p>
          {data
            ?.filter((s) => s.category === g.key)
            .map((s) => (
              <div key={s.key} className="src">
                <div className="src-text">
                  <a href={s.home} target="_blank" rel="noreferrer noopener" className="src-name">
                    {s.name}
                  </a>
                  <span className={`src-status ${s.status === 'failed' ? 'src-status--bad' : ''}`}>
                    {!s.enabled ? '已关闭' : s.status === 'failed' ? `上次失败：${s.last_error}` : s.last_success_at ? `${timeAgo(s.last_success_at)}更新，近 24 小时 ${s.last_count} 条` : '还没抓取过'}
                  </span>
                </div>
                <Switch checked={s.enabled} onChange={(v) => toggle.mutate({ key: s.key, enabled: v })} label={`${s.name} 开关`} />
              </div>
            ))}
        </div>
      ))}
    </section>
  )
}

function MusicSection() {
  const dir = useStore(player, (s) => s.dir)
  const count = useStore(player, (s) => s.tracks.length)
  return (
    <section className="set-sec">
      <h3 className="set-title">本地音乐</h3>
      <p className="set-hint">
        把音乐文件放进 <code>{dir || '~/.local/share/feixing/music'}</code>，支持 mp3、flac、m4a、ogg、opus、wav。同名的 .lrc 是歌词，同名图片或 cover.jpg 是封面。
      </p>
      <div className="set-inline">
        <span className="faint">现在有 {count} 首</span>
        <button className="btn btn--sm" onClick={() => void loadTracks(true).then((t) => toast(`扫描到 ${t.length} 首`))}>
          <RotateCw size={13} />
          重新扫描
        </button>
      </div>
    </section>
  )
}

export default function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePrefs((x) => x)
  return (
    <Sheet open={open} onClose={onClose} title="设置" side="right" width={440}>
      <section className="set-sec">
        <h3 className="set-title">外观</h3>
        <Row label="主题">
          <Tabs
            size="sm"
            value={p.theme}
            onChange={(t: ThemePref) => switchTheme(t)}
            options={[
              { value: 'night', label: '夜' },
              { value: 'dawn', label: '晨' },
              { value: 'auto', label: '跟随系统' },
            ]}
          />
        </Row>
        <Row label="天空" hint="雪和雨会用到一点 GPU，其余几乎不耗电">
          <Tabs
            size="sm"
            value={p.ambient}
            onChange={(a: Ambient) => prefs.set({ ambient: a })}
            options={[
              { value: 'stars', label: '星空' },
              { value: 'snow', label: '落雪' },
              { value: 'rain', label: '细雨' },
              { value: 'none', label: '无' },
            ]}
          />
        </Row>
        <Row label="极光">
          <Switch checked={p.aurora} onChange={(v) => prefs.set({ aurora: v })} label="极光" />
        </Row>
        <Row label="飞星" hint="偶尔有流星划过；保存日记时也会有一颗">
          <Switch checked={p.meteors} onChange={(v) => prefs.set({ meteors: v })} label="飞星" />
        </Row>
        <Row label="动效">
          <Tabs
            size="sm"
            value={p.motion}
            onChange={(m: 'full' | 'reduced') => prefs.set({ motion: m })}
            options={[
              { value: 'full', label: '完整' },
              { value: 'reduced', label: '减弱' },
            ]}
          />
        </Row>
      </section>
      <WallpaperSection />
      <section className="set-sec">
        <h3 className="set-title">写作</h3>
        <div className="fonts">
          {(['serif', 'kai'] as const).map((f) => (
            <button key={f} className={`font-card ${p.editorFont === f ? 'font-card--on' : ''}`} onClick={() => prefs.set({ editorFont: f })}>
              <span className={`font-sample ${f}`}>夜色温柔</span>
              <span className="faint">{f === 'serif' ? '宋体' : '楷体'}</span>
              {p.editorFont === f && <CheckIcon size={14} className="font-check" />}
            </button>
          ))}
        </div>
      </section>
      <ProfileSection />
      <NewsSection />
      <MusicSection />
      <section className="set-sec">
        <h3 className="set-title">关于</h3>
        <ContactLinks />
      </section>
    </Sheet>
  )
}
