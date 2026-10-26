export interface LyricLine {
  time: number
  text: string
  trans?: string
}

const isChinese = (s: string) => /[一-鿿]/.test(s) && !/[぀-ヿ가-힯]/.test(s)

/**
 * 解析 LRC。双语歌词两种排法都认：
 * - 原句与译文同一时间戳（原句在前）→ 译文属于这一句；
 * - 译文标的是下一句的时间（译文在前）→ 译文属于上一句。
 */
export function parseLrc(raw: string): LyricLine[] {
  const rows: { time: number; text: string; order: number }[] = []
  let offset = 0
  let order = 0
  for (const line of raw.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(line)
    if (off) offset = Number(off[1]) / 1000
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g)]
    if (!stamps.length) continue
    const text = line.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) rows.push({ time: Math.max(0, Number(s[1]) * 60 + Number(s[2]) - offset), text, order: order++ })
  }
  rows.sort((a, b) => a.time - b.time || a.order - b.order)

  const groups: { time: number; texts: string[] }[] = []
  for (const r of rows) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(g.time - r.time) < 0.02) g.texts.push(r.text)
    else groups.push({ time: r.time, texts: [r.text] })
  }

  const out: LyricLine[] = []
  for (const g of groups) {
    const texts = g.texts.filter(Boolean)
    if (texts.length <= 1) {
      out.push({ time: g.time, text: texts[0] || '' })
      continue
    }
    const [a, b] = texts
    if (isChinese(a) && !isChinese(b) && out.length && !out[out.length - 1].trans) {
      out[out.length - 1].trans = a
      out.push({ time: g.time, text: b })
    } else {
      out.push({ time: g.time, text: a, trans: b })
    }
  }
  return out.filter((l) => l.text || l.trans)
}

export function lineAt(lines: LyricLine[], t: number) {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t + 0.12) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
