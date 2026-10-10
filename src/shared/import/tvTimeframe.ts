/**
 * The timeframe of a TradingView screenshot, read from the chart's legend in the top left corner:
 * "Euro / British Pound · 1h · OANDA  O… H… L… C…". The interval is the word between the two dots after the name.
 *
 * Several readings of the legend (coloured pixels – candles, the OHLC values – turned into background, several
 * enlargements; the legend's line alone again when the corner gave no clear answer) vote. A value is certain when at
 * least two readings agree and any other answer has a third of the votes at most. Without a legend nothing is
 * guessed. Pure functions on RGBA pixels and OCR words, the OCR itself is injected.
 */
import type { ChartImage, GrayImage } from './tvChart'
import type { OcrWord } from './xtbScreen'

interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface TimeframeReading {
  /** The journal's name: "H1", "M15", "D"…; null when not read. */
  name: string | null
  /** As TradingView writes it ("1h", "15", "1D"). */
  tv: string | null
  /** At least two readings agree; another answer has at most a third of their votes. */
  certain: boolean
  /** Every reading (null = no interval found), for the record. */
  readings: Array<string | null>
}

/** Tesseract settings for the legend: one block of text. */
export const LEGEND_OCR = { psm: 6, whitelist: '' } as const

/** The legend's part of the picture: the top left corner. */
export function legendRegion(img: Pick<ChartImage, 'width' | 'height'>): { width: number; height: number } {
  return { width: Math.max(1, Math.round(img.width * 0.55)), height: Math.min(img.height, Math.max(80, Math.round(img.height * 0.09))) }
}

/**
 * The legend enlarged in grayscale, dark text on light (a dark chart is inverted). With `desaturate` coloured pixels
 * (candles under the legend, the OHLC values, zones) become background, so only the grey text is left. Bilinear
 * enlargement keeps the soft letter edges Tesseract reads best.
 */
export function legendGray(img: ChartImage, scale: number, desaturate: number | null, box?: Box): GrayImage {
  const region = legendRegion(img)
  const X0 = box ? Math.max(0, Math.floor(box.left)) : 0
  const Y0 = box ? Math.max(0, Math.floor(box.top)) : 0
  const W = box ? Math.max(1, Math.min(img.width, Math.ceil(box.left + box.width)) - X0) : region.width
  const H = box ? Math.max(1, Math.min(img.height, Math.ceil(box.top + box.height)) - Y0) : region.height
  // Dark or light chart: from the whole legend corner (a box may be mostly text).
  let sum = 0
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) sum += img.data[(y * img.width + x) * 4 + 1]!
  const dark = sum / (region.width * region.height) < 128
  const src = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = ((Y0 + y) * img.width + X0 + x) * 4
      const r = img.data[i]!
      const g = img.data[i + 1]!
      const b = img.data[i + 2]!
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      const max = Math.max(r, g, b)
      const sat = max ? (max - Math.min(r, g, b)) / max : 0
      let v = dark ? 255 - l : l
      if (desaturate != null && sat > desaturate && max > 60) v = 255
      src[y * W + x] = v
    }
  const width = W * scale
  const height = H * scale
  const lum = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const fy = Math.min(H - 1, Math.max(0, (y + 0.5) / scale - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(H - 1, y0 + 1)
    const ay = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(W - 1, Math.max(0, (x + 0.5) / scale - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(W - 1, x0 + 1)
      const ax = fx - x0
      const top = src[y0 * W + x0]! * (1 - ax) + src[y0 * W + x1]! * ax
      const bottom = src[y1 * W + x0]! * (1 - ax) + src[y1 * W + x1]! * ax
      lum[y * width + x] = Math.round(top * (1 - ay) + bottom * ay)
    }
  }
  return { width, height, lum }
}

/** OCR's usual misreadings in an interval: a thin "1" as T / I / l / |, "0" as O, "h" as n / b. */
const DIGIT: Record<string, string> = { T: '1', t: '1', I: '1', l: '1', '|': '1', i: '1', '!': '1', O: '0', o: '0' }
const UNIT: Record<string, string> = { n: 'h', b: 'h', H: 'h' }

/** TradingView's interval as written ("1h", "15", "15m", "1D", "W"…), or null for anything else. */
export function normalizeInterval(raw: string): string | null {
  const s = raw.replace(/[·•∙]/g, '').trim()
  if (/^[DWM]$/.test(s)) return s
  const m = /^([0-9TtIl|i!Oo]{1,3})([smhHDWMnb]?)$/.exec(s)
  if (!m) return null
  const num = m[1]!
    .split('')
    .map((c) => DIGIT[c] ?? c)
    .join('')
  if (!/^[1-9]\d*$/.test(num)) return null
  // A misread letter alone is no number ("T" without a unit).
  if (!/\d/.test(m[1]!) && !m[2]) return null
  const unit = UNIT[m[2]!] ?? m[2]!
  const n = Number(num)
  // Plausible TradingView intervals only.
  if (unit === '' || unit === 'm') return n <= 720 ? `${n}${unit}` : null
  if (unit === 's') return n <= 60 ? `${n}s` : null
  if (unit === 'h') return n <= 24 ? `${n}h` : null
  return n <= 12 ? `${n}${unit}` : null
}

/** The journal's name of an interval: minutes "M15", hours "H4", "D", "W", months "MN"; several days / weeks "D2", "W2". */
export function intervalName(tv: string): string {
  if (tv === 'D' || tv === 'W') return tv
  if (tv === 'M') return 'MN'
  const m = /^(\d+)([smhDWM]?)$/.exec(tv)
  if (!m) return tv
  const n = Number(m[1])
  switch (m[2]) {
    case '':
    case 'm':
      return n % 60 === 0 ? `H${n / 60}` : `M${n}`
    case 's':
      return `S${n}`
    case 'h':
      return `H${n}`
    case 'D':
      return n === 1 ? 'D' : `D${n}`
    case 'W':
      return n === 1 ? 'W' : `W${n}`
    default:
      return n === 1 ? 'MN' : `MN${n}`
  }
}

const SEPARATOR = /^[·•∙\-–—+*=~:.]+$/

/**
 * The interval in one OCR reading of the legend: the first word (top to bottom) standing between two separators
 * ("· 1h ·"), or glued to them ("·1h·").
 */
export function intervalFromWords(words: readonly OcrWord[]): string | null {
  return findInterval(words)?.interval ?? null
}

/** The interval and the box of its line (in the words' coordinates). */
function findInterval(words: readonly OcrWord[]): { interval: string; line: Box } | null {
  const lines: OcrWord[][] = []
  const byLine = new Map<string, OcrWord[]>()
  for (const w of words) {
    let line = byLine.get(w.line)
    if (!line) {
      line = []
      byLine.set(w.line, line)
      lines.push(line)
    }
    line.push(w)
  }
  lines.sort((a, b) => Math.min(...a.map((w) => w.top)) - Math.min(...b.map((w) => w.top)))
  for (const line of lines) {
    const ws = [...line].sort((a, b) => a.left - b.left)
    const box = () => {
      const left = Math.min(...ws.map((w) => w.left))
      const top = Math.min(...ws.map((w) => w.top))
      return { left, top, width: Math.max(...ws.map((w) => w.left + w.width)) - left, height: Math.max(...ws.map((w) => w.top + w.height)) - top }
    }
    for (let i = 0; i < ws.length; i++) {
      const glued = /^[·•∙]([^·•∙]+)[·•∙]$/.exec(ws[i]!.text)
      if (glued) {
        const iv = normalizeInterval(glued[1]!)
        if (iv) return { interval: iv, line: box() }
      }
      if (i === 0 || i === ws.length - 1) continue
      if (!SEPARATOR.test(ws[i - 1]!.text) || !SEPARATOR.test(ws[i + 1]!.text)) continue
      const iv = normalizeInterval(ws[i]!.text)
      if (iv) return { interval: iv, line: box() }
    }
  }
  return null
}

/** The vote of several readings. */
export function voteTimeframe(readings: Array<string | null>): TimeframeReading {
  const counts = new Map<string, number>()
  for (const r of readings) if (r) counts.set(r, (counts.get(r) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const best = ranked[0]
  if (!best) return { name: null, tv: null, certain: false, readings }
  // A tie is no answer; a lone reading or one against others is shown as unsure.
  if (ranked.length > 1 && ranked[1]![1] === best[1]) return { name: null, tv: null, certain: false, readings }
  // Certain: at least two readings, and any other answer is a stray one (three times fewer votes).
  const second = ranked[1]?.[1] ?? 0
  return { name: intervalName(best[0]), tv: best[0], certain: best[1] >= 2 && best[1] >= 3 * second, readings }
}

/**
 * Readings of the legend: coloured pixels dropped above two saturations (lossy compression tints grey text), three
 * enlargements, and as it is.
 */
const READINGS: Array<{ scale: number; desaturate: number | null }> = [
  { scale: 4, desaturate: 0.35 },
  { scale: 3, desaturate: 0.35 },
  { scale: 4, desaturate: 0.6 },
  { scale: 3, desaturate: 0.6 },
  { scale: 5, desaturate: 0.35 },
  { scale: 4, desaturate: null }
]
/** The legend's line alone, read again when the corner gave one answer only (candles crossing the text). */
const LINE_READINGS: Array<{ scale: number; desaturate: number | null }> = [
  { scale: 5, desaturate: 0.35 },
  { scale: 4, desaturate: 0.35 },
  { scale: 5, desaturate: 0.6 },
  { scale: 6, desaturate: 0.35 }
]

export async function readTimeframe(img: ChartImage, ocr: (gray: GrayImage) => Promise<OcrWord[]>): Promise<TimeframeReading> {
  const readings: Array<string | null> = []
  let line: Box | null = null
  for (const r of READINGS) {
    const found = findInterval(await ocr(legendGray(img, r.scale, r.desaturate)))
    readings.push(found?.interval ?? null)
    if (found && !line) line = { left: found.line.left / r.scale, top: found.line.top / r.scale, width: found.line.width / r.scale, height: found.line.height / r.scale }
  }
  let vote = voteTimeframe(readings)
  if (!vote.certain && line) {
    const pad = line.height * 0.6
    const box = { left: line.left - pad, top: line.top - pad, width: line.width + 2 * pad, height: line.height + 2 * pad }
    for (const r of LINE_READINGS) readings.push(findInterval(await ocr(legendGray(img, r.scale, r.desaturate, box)))?.interval ?? null)
    vote = voteTimeframe(readings)
  }
  return vote
}
