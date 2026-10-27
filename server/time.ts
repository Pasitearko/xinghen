// 「哪一天」按本机时区判定（XINGHEN_TZ 可覆盖），跨过本地午夜后前一天的日记封存为只读。
export const TZ = process.env.XINGHEN_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })

export function dayKey(at: Date | number | string = new Date()): string {
  return dayFmt.format(at instanceof Date ? at : new Date(at))
}

export function todayKey() {
  return dayKey()
}

export function localHour(at = new Date()) {
  return Number(hourFmt.format(at)) % 24
}

export function nowIso() {
  return new Date().toISOString()
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** 在 YYYY-MM-DD 上加减天数（纯日历计算，与时区无关）。 */
export function addDays(key: string, days: number) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
