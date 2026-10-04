const MINUS = '−'

function signed(value: number, decimals: number): string {
  const abs = Math.abs(value).toFixed(decimals)
  if (Number(abs) === 0) return (0).toFixed(decimals)
  return `${value < 0 ? MINUS : '+'}${abs}`
}

export function fmtR(r: number | null | undefined, decimals = 2): string {
  return r == null || !Number.isFinite(r) ? '—' : `${signed(r, decimals)}R`
}

export function fmtPips(p: number | null | undefined): string {
  return p == null || !Number.isFinite(p) ? '—' : signed(p, 1)
}

export function fmtNum(v: number | null | undefined, decimals = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(decimals)
}

export function fmtRatio(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}`
}

export function fmtPrice(v: number | null | undefined, decimals = 5): string {
  return v == null || !Number.isFinite(v) ? '' : v.toFixed(decimals)
}

export function fmtPercent(v: number | null | undefined, decimals = 0): string {
  return v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(decimals)}%`
}

export function fmtMoney(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${signed(v, 2)} ${currency}`
}

/** Signed amount with grouped thousands (large P/L amounts): +1 250 000.00 USD. */
export function fmtMoneyGrouped(v: number | null | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const [int, dec] = signed(v, 2).split('.')
  return `${(int ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}.${dec} ${currency}`
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** Tone used for result coloring: green/red only for P&L. */
export function tone(v: number | null | undefined, beThreshold = 0): 'up' | 'down' | 'flat' {
  if (v == null || !Number.isFinite(v) || Math.abs(v) <= beThreshold) return 'flat'
  return v > 0 ? 'up' : 'down'
}

export const toneClass = { up: 'text-up', down: 'text-down', flat: 'text-muted' } as const

/** Parse user-typed numbers: accepts comma or dot, spaces. Returns undefined when invalid. */
export function parseNumberInput(text: string): number | null | undefined {
  const t = text.trim().replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Parse "330", "3:30", "03.30", "0330" → "03:30". */
export function parseClockInput(text: string): string | null {
  const t = text.trim().replace(/[.,;h ]/g, ':')
  let h: number
  let m: number
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(t)
  if (colon) {
    h = Number(colon[1])
    m = Number(colon[2])
  } else if (/^\d{3,4}$/.test(t)) {
    h = Number(t.slice(0, t.length - 2))
    m = Number(t.slice(-2))
  } else if (/^\d{1,2}$/.test(t)) {
    h = Number(t)
    m = 0
  } else return null
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Parse "2026-03-16", "16.03.2026", "16.03" (current year). */
export function parseDateInput(text: string, fallbackYear = new Date().getFullYear()): string | null {
  const t = text.trim()
  let y: number
  let mo: number
  let d: number
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) {
    y = Number(m[1])
    mo = Number(m[2])
    d = Number(m[3])
  } else if ((m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/.exec(t))) {
    d = Number(m[1])
    mo = Number(m[2])
    y = m[3] ? Number(m[3]) : fallbackYear
  } else return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export const WEEKDAY_PL = ['', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd']
