// 播放器状态：全站只有一个 <audio>，切页不断。接入 Media Session，
// Linux 桌面的媒体键、MPRIS（GNOME/KDE 的播放控件）都能控制它。
import { api, type Track } from './api'
import { parseLrc, type LyricLine } from './lrc'
import { createStore, prefs } from './store'

export type Mode = 'all' | 'one' | 'shuffle'

interface PlayerState {
  tracks: Track[]
  dir: string
  index: number
  playing: boolean
  duration: number
  mode: Mode
  lyrics: LyricLine[]
  error: string
  loaded: boolean
}

export const player = createStore<PlayerState>({ tracks: [], dir: '', index: -1, playing: false, duration: 0, mode: 'all', lyrics: [], error: '', loaded: false })

export const audio = new Audio()
audio.preload = 'metadata'
audio.volume = prefs.get().volume

const lyricCache = new Map<string, LyricLine[]>()
async function lyricsFor(t: Track) {
  if (!t.has_lyrics) return []
  if (lyricCache.has(t.id)) return lyricCache.get(t.id)!
  try {
    const { text } = await api.get<{ text: string }>(`/api/music/lyrics/${t.id}`)
    const lines = parseLrc(text)
    lyricCache.set(t.id, lines)
    return lines
  } catch {
    return []
  }
}

export const coverUrl = (t: Track) => (t.has_cover ? `/api/music/cover/${t.id}` : '')

export async function loadTracks(refresh = false) {
  try {
    const r = await api.get<{ dir: string; tracks: Track[] }>(`/api/music/tracks${refresh ? '?refresh=1' : ''}`)
    const cur = player.get().tracks[player.get().index]
    const index = cur ? r.tracks.findIndex((t) => t.id === cur.id) : -1
    let saved = -1
    try {
      saved = r.tracks.findIndex((t) => t.id === localStorage.getItem('feixing.track'))
    } catch {
      /* ignore */
    }
    player.set({ tracks: r.tracks, dir: r.dir, index: index >= 0 ? index : saved, loaded: true })
    if (index < 0 && saved >= 0 && !audio.src) prepare(saved, false)
    return r.tracks
  } catch {
    player.set({ loaded: true })
    return []
  }
}

function prepare(i: number, autoplay: boolean) {
  const t = player.get().tracks[i]
  if (!t) return
  audio.src = `/api/music/file/${t.id}`
  player.set({ index: i, lyrics: [], error: '', duration: 0 })
  try {
    localStorage.setItem('feixing.track', t.id)
  } catch {
    /* ignore */
  }
  void lyricsFor(t).then((lines) => player.get().index === i && player.set({ lyrics: lines }))
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: t.has_cover ? [{ src: coverUrl(t), sizes: '512x512' }] : [],
    })
  }
  if (autoplay) void audio.play().catch((e) => player.set({ error: e.name === 'NotAllowedError' ? '' : '这首歌放不了', playing: false }))
  // 预取下一首的歌词
  const next = player.get().tracks[(i + 1) % player.get().tracks.length]
  if (next) void lyricsFor(next)
}

export function playIndex(i: number) {
  if (i === player.get().index && audio.src) return toggle()
  prepare(i, true)
}

export function toggle() {
  const s = player.get()
  if (s.index < 0 && s.tracks.length) return prepare(0, true)
  if (audio.paused) void audio.play().catch(() => player.set({ error: '这首歌放不了' }))
  else audio.pause()
}

function pick(step: 1 | -1) {
  const s = player.get()
  const n = s.tracks.length
  if (!n) return -1
  if (s.mode === 'shuffle' && n > 1) {
    let r = s.index
    while (r === s.index) r = Math.floor(Math.random() * n)
    return r
  }
  return (s.index + step + n) % n
}

export const next = () => prepare(pick(1), true)
export function prev() {
  if (audio.currentTime > 4) audio.currentTime = 0
  else prepare(pick(-1), true)
}
export function seek(t: number) {
  if (Number.isFinite(t)) audio.currentTime = Math.max(0, Math.min(t, audio.duration || t))
}
export function setVolume(v: number) {
  audio.volume = v
  prefs.set({ volume: v })
}
export function cycleMode() {
  const order: Mode[] = ['all', 'one', 'shuffle']
  player.set((s) => ({ mode: order[(order.indexOf(s.mode) + 1) % 3] }))
}

let failures = 0
audio.addEventListener('play', () => player.set({ playing: true, error: '' }))
audio.addEventListener('pause', () => player.set({ playing: false }))
audio.addEventListener('loadedmetadata', () => player.set({ duration: audio.duration }))
audio.addEventListener('playing', () => (failures = 0))
audio.addEventListener('ended', () => {
  if (player.get().mode === 'one') {
    audio.currentTime = 0
    void audio.play()
  } else next()
})
audio.addEventListener('error', () => {
  player.set({ error: '这首歌放不了，跳到下一首', playing: false })
  // 连续失败到整张歌单都试过一遍就停下
  if (++failures < player.get().tracks.length) setTimeout(next, 800)
})

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  ms.setActionHandler('play', toggle)
  ms.setActionHandler('pause', toggle)
  ms.setActionHandler('nexttrack', next)
  ms.setActionHandler('previoustrack', prev)
  ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime))
}
