// 日期工具。农历用浏览器内置的中国历（Intl），节气用寿星公式近似，都不需要第三方库。

export const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
export const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六']

export function dateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseKey(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: string, n: number) {
  const d = parseKey(key)
  d.setDate(d.getDate() + n)
  return dateKey(d)
}

export function weekday(key: string) {
  return WEEK[parseKey(key).getDay()]
}

export function cnDate(key: string, withYear = false) {
  const [y, m, d] = key.split('-').map(Number)
  return `${withYear ? `${y}年` : ''}${m}月${d}日`
}

const lunarFmt = (() => {
  try {
    return new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' })
  } catch {
    return null
  }
})()

const DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']

/** 农历：{ month: '九月', day: '初六' } */
export function lunar(d: Date) {
  if (!lunarFmt) return null
  const parts = lunarFmt.formatToParts(d)
  const month = parts.find((p) => p.type === 'month')?.value || ''
  const dayNum = Number(parts.find((p) => p.type === 'day')?.value)
  if (!month || !dayNum) return null
  return { month, day: DAY_NAMES[dayNum - 1] || String(dayNum) }
}

const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至']
// 21 世纪节气 C 值（寿星通用公式）
const C21 = [5.4055, 20.12, 3.87, 18.73, 5.63, 20.646, 4.81, 20.1, 5.52, 21.04, 5.678, 21.37, 7.108, 22.83, 7.5, 23.13, 7.646, 23.042, 8.318, 23.438, 7.438, 22.36, 7.18, 21.94]

/** 某年第 i 个节气（0=小寒）落在几号 */
function termDay(year: number, i: number) {
  const y = year % 100
  const base = i < 4 ? y - 1 : y
  let day = Math.floor(y * 0.2422 + C21[i]) - Math.floor(base / 4)
  // 几个已知例外
  if (year === 2082 && i === 1) day += 1
  if (year === 2019 && i === 0) day -= 1
  return day
}

/** 当天若是节气返回节气名 */
export function solarTerm(d: Date) {
  const m = d.getMonth()
  for (const i of [m * 2, m * 2 + 1]) {
    if (termDay(d.getFullYear(), i) === d.getDate()) return TERMS[i]
  }
  return null
}

/** 最近经过的节气及已过天数，例如「霜降后第 3 天」 */
export function currentTerm(d: Date) {
  const y = d.getFullYear()
  let best: { name: string; date: Date } | null = null
  for (const yy of [y - 1, y]) {
    for (let i = 0; i < 24; i++) {
      const date = new Date(yy, Math.floor(i / 2), termDay(yy, i))
      if (date <= d && (!best || date > best.date)) best = { name: TERMS[i], date }
    }
  }
  if (!best) return null
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - best.date.getTime()) / 86400000)
  return { name: best.name, days }
}

export function greeting(h = new Date().getHours()) {
  if (h < 5) return '夜深了'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  if (h < 23) return '晚上好'
  return '夜深了'
}

export function timeAgo(iso: string | null) {
  if (!iso) return ''
  const diff = (Date.now() - Date.parse(iso)) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function clock(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h && m) return `${h} 小时 ${m} 分`
  if (h) return `${h} 小时`
  return `${m} 分钟`
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
