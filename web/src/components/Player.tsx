// 浮动播放器：收起时是一枚会转的唱片 + 当前这句歌词；点开展开成面板（共享布局动画）。
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, ListMusic, Music2, Pause, Play, Repeat, Repeat1, RotateCw, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { lineAt } from '../lib/lrc'
import { SPRING_PANEL } from '../lib/motion'
import { audio, coverUrl, cycleMode, loadTracks, next, player, playIndex, prev, seek, setVolume, toggle } from '../lib/player'
import { usePrefs, useStore } from '../lib/store'
import './player.css'

function useTime(active: boolean) {
  const [t, setT] = useState(audio.currentTime)
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 50) return
      last = now
      setT(audio.currentTime)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
  useEffect(() => {
    const on = () => setT(audio.currentTime)
    audio.addEventListener('seeked', on)
    audio.addEventListener('emptied', on)
    return () => {
      audio.removeEventListener('seeked', on)
      audio.removeEventListener('emptied', on)
    }
  }, [])
  return t
}

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00')

function Disc({ url, spinning, size }: { url: string; spinning: boolean; size: number }) {
  return (
    <span className={`disc ${spinning ? 'disc--spin' : ''}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <Music2 size={size * 0.4} />}
    </span>
  )
}

export default function Player() {
  const s = useStore(player, (x) => x)
  const volume = usePrefs((p) => p.volume)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(false)
  const t = useTime(s.playing)
  const lyricBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadTracks()
  }, [])

  const track = s.tracks[s.index]
  const li = lineAt(s.lyrics, t)
  const line = s.lyrics[li]

  useEffect(() => {
    // 展开时让当前歌词行保持在中间
    // 只滚歌词框本身；scrollIntoView 会连带滚动外层面板，把顶栏推出去
    const box = lyricBox.current
    const el = box?.querySelector<HTMLElement>(`[data-i="${li}"]`)
    if (box && el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [li, open])

  if (!s.loaded || !s.tracks.length) return null
  const cover = track ? coverUrl(track) : ''
  const progress = s.duration ? t / s.duration : 0

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
            <span className="mini-progress" style={{ transform: `scaleX(${progress})` }} />
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
                  {s.tracks.map((tr, i) => (
                    <li key={tr.id}>
                      <button className={`full-track ${i === s.index ? 'full-track--on' : ''}`} onClick={() => playIndex(i)}>
                        <span className="full-track-title">{tr.title}</span>
                        <span className="faint">{tr.artist}</span>
                      </button>
                    </li>
                  ))}
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
                  <div className="lyrics" ref={lyricBox}>
                    {s.lyrics.length ? (
                      s.lyrics.map((l, i) => (
                        <p key={i} data-i={i} className={`lyric ${i === li ? 'lyric--on' : ''}`} onClick={() => seek(l.time)}>
                          {l.text}
                          {l.trans && <small>{l.trans}</small>}
                        </p>
                      ))
                    ) : (
                      <p className="lyric faint">{!track || track.has_lyrics ? '' : '这首没有歌词，把同名 .lrc 放在旁边就会显示'}</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {s.error && <p className="full-error">{s.error}</p>}
            <div className="full-bar">
              <span>{fmt(t)}</span>
              <input
                type="range"
                min={0}
                max={s.duration || 0}
                step={0.1}
                value={t}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="播放进度"
                style={{ ['--p' as string]: `${progress * 100}%` }}
              />
              <span>{fmt(s.duration)}</span>
            </div>
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
