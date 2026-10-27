export class ApiError extends Error {
  status: number
  data: unknown
  constructor(status: number, message: string, data: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request<T>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': isRaw ? (body as Blob).type || 'application/octet-stream' : 'application/json', ...headers },
      body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, '连不上本机服务：星痕后台可能没在运行', null)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const detail = (data as { detail?: string } | null)?.detail
    throw new ApiError(res.status, detail || `请求失败（${res.status}）`, data)
  }
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', url, body ?? {}, headers),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = void>(url: string) => request<T>('DELETE', url),
}

// ---------- 类型 ----------
export interface DiaryEntry {
  id: number
  identity: string
  version: number
  date_key: string
  entry_index: number
  title: string
  content_md: string
  weather: string
  mood: string
  tags: string[]
  char_count: number
  excerpt: string
  cover_url: string
  created_at: string
  updated_at: string
  editable: boolean
  snippet?: string
}

export interface DiaryDay {
  date: string
  today: string
  editable: boolean
  entries: DiaryEntry[]
  prev: string | null
  next: string | null
}

export interface DateSummary {
  date: string
  count: number
  chars: number
  mood: string
  weather: string
}

export interface TasteImage {
  url: string
  /** 网格里用的小图（长边 720px），没有就用原图 */
  thumb?: string
  name?: string
  width?: number
  height?: number
}

export interface TasteItem {
  id: number
  type: 'link' | 'note'
  title: string
  subtitle: string
  url: string
  images: TasteImage[]
  tags: string[]
  category: string
  note: string
  created_at: string
  updated_at: string
}

export interface Todo {
  id: number
  title: string
  duration_minutes: number
  break_minutes: number
  completed_pomodoros: number
  is_completed: boolean
  sort_order: number
}

export interface ScheduleItem {
  id: number
  title: string
  date_key: string
  start_time: string
  end_time: string
  is_completed: boolean
}

export interface StudySession {
  id: number
  session_id: string
  todo_id: number | null
  todo_title?: string | null
  date_key: string
  started_at: string
  ended_at: string | null
  planned_minutes: number
  focused_seconds: number
  pomodoros: number
  status: 'running' | 'finished' | 'abandoned'
}

export interface StudyToday {
  date: string
  todos: Todo[]
  schedule: ScheduleItem[]
  active: StudySession | null
  stats: { seconds: number; pomodoros: number; sessions: number }
  sessions: StudySession[]
}

export type NewsCategory = 'official' | 'media' | 'community' | 'aggregate'
export type Company = 'anthropic' | 'openai' | 'deepseek'

export interface NewsItem {
  id: number
  brand: string
  company: Company
  /** 同一事件可关联多家；相关栏目引用相同的 event_id。 */
  companies: Company[]
  event_id: string
  event_kind: 'model-release' | 'model-upgrade' | 'product-update' | 'website-news'
  source_key: string
  source_name: string
  category: NewsCategory
  title: string
  summary: string
  url: string
  published_at: string | null
  fetched_at: string
  published_day: string
  dated: boolean
  /** 去重后这件事有多少个原文链接。 */
  reports: number
  links: { title: string; url: string; source_name: string }[]
}

export interface NewsFeed {
  today: string
  companies: { key: Company; items: NewsItem[] }[]
  refreshed_at: string | null
  refreshing: boolean
  failed: { key: string; name: string; error: string }[]
}

export interface NewsSource {
  key: string
  brand: string
  name: string
  category: NewsCategory
  home: string
  enabled: boolean
  status: string
  last_success_at: string | null
  last_attempt_at: string | null
  last_error: string
  last_count: number
}

export interface Profile {
  name: string
  motto: string
  avatar_url: string
}

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  has_lyrics: boolean
  has_cover: boolean
  size: number
}

export interface Wallpaper {
  id: string
  url: string
  name: string
  kind: 'preset' | 'upload'
}

export interface ImportReport {
  kind: string
  dry: boolean
  diaries: { added: number; skipped: number }
  taste: { added: number; skipped: number }
  study: { added: number; skipped: number }
  images: { added: number; skipped: number; inline: number }
  profile: boolean
  notes: string[]
}

/** 上传图片：先在浏览器里压到长边 2000px 以内再传，日记页打开更快。 */
export async function uploadImage(file: Blob, scope: 'diary' | 'taste' | 'avatar' | 'wallpaper', name = '') {
  const { compressImage } = await import('./image')
  const blob = await compressImage(file, scope === 'wallpaper' ? 2880 : scope === 'avatar' ? 512 : 2000)
  return api.post<{ url: string; filename: string }>(`/api/images?scope=${scope}&name=${encodeURIComponent(name)}`, blob)
}

/** 收藏图片：原图之外再传一张小图给网格用，滚动列表时不用解码大图。 */
export async function uploadWithThumb(file: Blob, name = '') {
  const { compressImage } = await import('./image')
  const full = await uploadImage(file, 'taste', name)
  if (/gif|svg/.test(file.type)) return { url: full.url }
  const small = await compressImage(file, 720, true)
  const thumb = await api.post<{ url: string }>(`/api/images?scope=taste&name=${encodeURIComponent('thumb-' + name)}`, small)
  return { url: full.url, thumb: thumb.url }
}
