// 浮动播放器：收起时是一枚会转的唱片 + 当前这句歌词；点开展开成面板（共享布局动画）。
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, ListMusic, Music2, Pause, Play, Repeat, Repeat1, RotateCw, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { Track } from '../lib/api'
import { lineAt, type LyricLine } from '../lib/lrc'
import { SPRING_PANEL } from '../lib/motion'
import { audio, coverUrl, cycleMode, loadTracks, next, player, playIndex, prev, seek, setVolume, toggle } from '../lib/player'
import { usePrefs, useStore } from '../lib/store'
import './player.css'

/**
 * 播放时按帧读 audio.currentTime，但只有 pick 出来的值变了才重渲染：
 * 歌词按「换句」、时间按秒、进度条按 1/4 秒，整个播放器不再每 50ms 重画一遍。
 */
function useAudioValue<T>(active: boolean, pick: (t: number) => T, key?: unknown): T {
  const [v, setV] = useState(() => pick(audio.currentTime))
  const pickRef = useRef(pick)
  pickRef.current = pick
  useEffect(() => {
    const read = () => setV(pickRef.current(audio.currentTime))
    read()
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 80) return
      last = now
      read()
    }
    if (active) raf = requestAnimationFrame(loop)
    audio.addEventListener('seeked', read)
    audio.addEventListener('emptied', read)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener('seeked', read)
      audio.removeEventListener('emptied', read)
    }
  }, [active, key])
  return v
}

/** 收起时底边那条细进度：直接改 transform，不经过 React */
function MiniProgress({ playing, duration }: { playing: boolean; duration: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const paint = () => ref.current && (ref.current.style.transform = `scaleX(${duration ? audio.currentTime / duration : 0})`)
    paint()
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 250) return
      last = now
      paint()
    }
    if (playing) raf = requestAnimationFrame(loop)
    audio.addEventListener('seeked', paint)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener('seeked', paint)
    }
  }, [playing, duration])
  return <span ref={ref} className="mini-progress" />
}

function SeekBar({ playing, duration }: { playing: boolean; duration: number }) {
  const t = useAudioValue(playing, (x) => Math.floor(x * 4) / 4)
  const progress = duration ? t / duration : 0
  return (
    <div className="full-bar">
      <span>{fmt(t)}</span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={t}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="播放进度"
        style={{ ['--p' as string]: `${progress * 100}%` }}
      />
      <span>{fmt(duration)}</span>
    </div>
  )
}

const Lyrics = memo(function Lyrics({ lyrics, li, hint }: { lyrics: LyricLine[]; li: number; hint: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 让当前歌词行保持在中间；只滚歌词框本身，scrollIntoView 会连带滚动外层面板，把顶栏推出去
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${li}"]`)
    if (box.current && el) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [li])
  return (
    <div className="lyrics" ref={box}>
      {lyrics.length ? (
        lyrics.map((l, i) => (
          <p key={i} data-i={i} className={`lyric ${i === li ? 'lyric--on' : ''}`} onClick={() => seek(l.time)}>
            {l.text}
            {l.trans && <small>{l.trans}</small>}
          </p>
        ))
      ) : (
        <p className="lyric faint">{hint}</p>
      )}
    </div>
  )
})

const TrackList = memo(function TrackList({ tracks, index }: { tracks: Track[]; index: number }) {
  return (
    <>
      {tracks.map((tr, i) => (
        <li key={tr.id}>
          <button className={`full-track ${i === index ? 'full-track--on' : ''}`} onClick={() => playIndex(i)}>
            <span className="full-track-title">{tr.title}</span>
            <span className="faint">{tr.artist}</span>
          </button>
        </li>
      ))}
    </>
  )
})

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00')

function Disc({ url, spinning, size }: { url: string; spinning: boolean; size: number }) {
  // 封面图被删掉或挪走时，退回唱片图标，不显示破图
  const [broken, setBroken] = useState('')
  return (
    <span className={`disc ${spinning ? 'disc--spin' : ''}`} style={{ width: size, height: size }}>
      {url && broken !== url ? <img src={url} alt="" onError={() => setBroken(url)} /> : <Music2 size={size * 0.4} />}
    </span>
  )
}

export default function Player() {
  const s = useStore(player, (x) => x)
  const volume = usePrefs((p) => p.volume)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(false)
  // 主体只在换句时重渲染；时间和进度各自更新
  const li = useAudioValue(s.playing, (t) => lineAt(s.lyrics, t), s.lyrics)

  useEffect(() => {
    void loadTracks()
  }, [])

  const track = s.tracks[s.index]
  const line = s.lyrics[li]

  if (!s.loaded || !s.tracks.length) return null
  const cover = track ? coverUrl(track) : ''

  return (
    <div className="player-root">
      <AnimatePresence mode="popLayout" initial={false}>
        {!open ? (
          <motion.div key="mini" layoutId="player" className="mini glass" transition={SPRING_PANEL}>
            <button className="mini-main" onClick={() => setOpen(true)} aria-label="展开播放器">
              <Disc url={cover} spinning={s.playing} size={38} />
              <span className="mini-text">
                <span className="mini-title">{track ? track.title : '本地音乐'}</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={line ? li : 'artist'} className="mini-line" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>
                    {(s.playing && line?.text) || track?.artist || `${s.tracks.length} 首`}
                  </motion.span>
                </AnimatePresence>
              </span>
            </button>
            <button className="icon-btn" onClick={toggle} aria-label={s.playing ? '暂停' : '播放'}>
              {s.playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="icon-btn" onClick={next} aria-label="下一首">
              <SkipForward size={16} />
            </button>
            <MiniProgress playing={s.playing} duration={s.duration} />
          </motion.div>
        ) : (
          <motion.div key="full" layoutId="player" className="full glass" transition={SPRING_PANEL}>
            <div className="full-bg" style={{ backgroundImage: cover ? `url(${cover})` : undefined }} />
            <header className="full-head">
              <button className="icon-btn" onClick={() => setList((v) => !v)} aria-label="歌单" aria-pressed={list}>
                <ListMusic size={18} />
              </button>
              <span className="faint full-count">
                {s.index + 1} / {s.tracks.length}
              </span>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="收起播放器">
                <ChevronDown size={18} />
              </button>
            </header>
            <AnimatePresence mode="wait" initial={false}>
              {list ? (
                <motion.ul key="list" className="full-list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <TrackList tracks={s.tracks} index={s.index} />
                  <li>
                    <button className="btn btn--sm btn--ghost" onClick={() => void loadTracks(true)}>
                      <RotateCw size={13} />
                      重新扫描音乐文件夹
                    </button>
                  </li>
                </motion.ul>
              ) : (
                <motion.div key="now" className="full-now" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Disc url={cover} spinning={s.playing} size={148} />
                  <div className="full-meta">
                    <p className="full-title">{track?.title || '选一首歌'}</p>
                    <p className="faint">{[track?.artist, track?.album].filter(Boolean).join('，')}</p>
                  </div>
                  <Lyrics lyrics={s.lyrics} li={li} hint={!track || track.has_lyrics ? '' : '这首没有歌词，把同名 .lrc 放在旁边就会显示'} />
                </motion.div>
              )}
            </AnimatePresence>
            {s.error && <p className="full-error">{s.error}</p>}
            <SeekBar playing={s.playing} duration={s.duration} />
            <div className="full-controls">
              <button className="icon-btn" onClick={cycleMode} aria-label={{ all: '列表循环', one: '单曲循环', shuffle: '随机播放' }[s.mode]} title={{ all: '列表循环', one: '单曲循环', shuffle: '随机播放' }[s.mode]}>
                {s.mode === 'one' ? <Repeat1 size={17} /> : s.mode === 'shuffle' ? <Shuffle size={17} /> : <Repeat size={17} />}
              </button>
              <button className="icon-btn" onClick={prev} aria-label="上一首">
                <SkipBack size={19} />
              </button>
              <motion.button className="play-btn" onClick={toggle} whileTap={{ scale: 0.92 }} aria-label={s.playing ? '暂停' : '播放'}>
                {s.playing ? <Pause size={22} /> : <Play size={22} />}
              </motion.button>
              <button className="icon-btn" onClick={next} aria-label="下一首">
                <SkipForward size={19} />
              </button>
              <label className="vol" title="音量">
                <Volume2 size={16} />
                <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="音量" style={{ ['--p' as string]: `${volume * 100}%` }} />
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
