/**
 * MAE / MFE from a TradingView screenshot taken after the trade ("po"): the Long / Short Position tool shows the entry,
 * stop and target; the candles inside it show how far price went against and for the position before it closed.
 *
 * 1. Price scale: the price axis is read by OCR (`axisLabels`), a line price = a + b·y is fitted robustly (`fitPriceScale`).
 * 2. The tool: two filled rectangles stacked on each other with the same left / right edges (`findPositionTools`),
 *    found from horizontal and vertical colour steps – independent of the colour scheme (red / green, blue / grey…).
 * 3. Candles: pixels of the two candle colours (detected from the picture), horizontal lines removed.
 * 4. From the tool's left edge to the first touch of the stop or target (or the tool's right edge), the farthest wick
 *    against / for the position, clipped at the level that closed the trade (`measureExcursions`).
 *
 * Pure functions on RGBA pixels and OCR words, so they are tested without a browser.
 */
import type { OcrWord } from './xtbScreen'

export interface ChartImage {
  width: number
  height: number
  data: ArrayLike<number>
}

export interface AxisLabel {
  /** For a label read without its leading digits ("12000" for 1.12000): the digits read; value is then NaN. */
  suffix?: string
  /** Digits after the point as printed ("1.12800" → 5). */
  decimals?: number
  value: number
  /** Centre of the label (image pixels). */
  y: number
  x: number
  conf: number
}

export interface PriceScale {
  /** price = a + b·y */
  a: number
  b: number
  /** Labels on the line and the largest miss among them (pixels). */
  n: number
  maxResidualPx: number
  labels: AxisLabel[]
}

export interface ToolBox {
  left: number
  right: number
  top: number
  bottom: number
  /** Horizontal edges inside the box with the same left / right ends (the entry split, the tool's "progress" shading). */
  inner: number[]
  /** The box runs past the edge of the picture or of the plot there (its level is not on the screenshot). */
  cutTop?: boolean
  cutBottom?: boolean
}

export interface ExcursionInput {
  direction: 'long' | 'short'
  entry: number | null
  stopLoss: number | null
  takeProfit: number | null
  /** Final exit price (decides whether the target closed the trade). */
  exitPrice: number | null
  pipSize: number
  /** Leave out the candle at the tool's left edge (part of it may be from before the entry). */
  skipEntryCandle?: boolean
}

export interface Excursion {
  /** Adverse excursion as a negative number of pips (journal convention), favourable as a positive one. */
  maePips: number
  mfePips: number
  exit: 'stop' | 'target' | 'end'
  /** Prices read from the tool (entry = split, stop / target = outer edges). */
  tool: { entry: number; stop: number | null; target: number | null }
  box: ToolBox
  splitY: number
  /** Measured columns and the points found (image pixels) for the preview. */
  range: { x0: number; x1: number }
  /** Right end of the candle at the tool's left edge (x0 − 1 when there is none). */
  entryCandleEnd: number
  points: { mae: { x: number; y: number } | null; mfe: { x: number; y: number } | null; exit: { x: number; y: number } | null }
  warnings: string[]
}

export type TvAnalysis = ({ ok: true } & Excursion & { scale: PriceScale; tools: number }) | { ok: false; error: string; scale: PriceScale | null }

// ------------------------------------------------------------------ pixels

const at = (img: ChartImage, x: number, y: number) => (y * img.width + x) * 4

/** Hue 0–360, saturation and value 0–1. */
function hsv(img: ChartImage, x: number, y: number): [number, number, number] {
  const i = at(img, x, y)
  return rgbHsv([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
}

function rgbHsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const c = max - min
  let h = 0
  if (c > 0) {
    if (max === r) h = ((g - b) / c) % 6
    else if (max === g) h = (b - r) / c + 2
    else h = (r - g) / c + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? c / max : 0, max / 255]
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// ------------------------------------------------------------------ price axis

/** The strip at the right edge read by OCR for the price axis. */
export function axisStrip(img: Pick<ChartImage, 'width' | 'height'>): { left: number; width: number } {
  const width = Math.min(img.width, Math.max(150, Math.round(img.width * 0.11)))
  return { left: img.width - width, width }
}

/**
 * Left edge of the axis labels' column from a first reading of the strip (the most common left of words with at least
 * three digits), or null. The second reading of just that column is cleaner (no candles to confuse the page layout).
 */
export function labelColumn(words: readonly OcrWord[]): number | null {
  const lefts = words.filter((w) => (w.text.match(/\d/g)?.length ?? 0) >= 3).map((w) => Math.round(w.left / 4))
  if (lefts.length < 2) return null
  const mode = mostCommon(lefts)
  const near = lefts.filter((l) => Math.abs(l - mode) <= 1)
  return near.length >= 2 ? Math.min(...near) * 4 : null
}

/** Tesseract settings for the axis: sparse text, digits only. */
export const AXIS_OCR = { psm: 11, whitelist: '0123456789.,' } as const
/** Enlargement for OCR (axis digits are ~10 px tall; Tesseract likes ~30 px). */
const AXIS_SCALE = 3

export interface GrayImage {
  width: number
  height: number
  /** 0–255, row by row. */
  lum: Uint8Array
}

/** A part of the right edge (from `left`, rows y0…y1) to be read by OCR. */
export interface AxisCrop {
  left: number
  y0: number
  y1: number
}

/** The crop enlarged ×3 in grayscale with dark text on light (a dark chart is inverted); pixels kept sharp. */
export function axisGray(img: ChartImage, crop: AxisCrop): GrayImage {
  const k = AXIS_SCALE
  const width = (img.width - crop.left) * k
  const height = (crop.y1 - crop.y0) * k
  let sum = 0
  let n = 0
  for (let y = 0; y < img.height; y += 4)
    for (let x = crop.left; x < img.width; x += 4) {
      sum += img.data[at(img, x, y) + 1]!
      n++
    }
  const dark = n > 0 && sum / n < 128
  const lum = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = at(img, crop.left + Math.floor(x / k), crop.y0 + Math.floor(y / k))
      const l = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!
      lum[y * width + x] = Math.floor(dark ? 255 - l : l)
    }
  return { width, height, lum }
}

/**
 * Words of the price axis in image coordinates: the strip at the right edge is read, then just the labels' column
 * (cleaner: no candles to confuse the page layout); without a column, overlapping tiles of the strip are added.
 * `ocr` reads a grayscale image with `AXIS_OCR`.
 */
export async function readAxisWords(img: ChartImage, ocr: (gray: GrayImage) => Promise<OcrWord[]>): Promise<OcrWord[]> {
  const read = async (crop: AxisCrop) =>
    (await ocr(axisGray(img, crop))).map((w) => ({
      ...w,
      left: crop.left + w.left / AXIS_SCALE,
      top: crop.y0 + w.top / AXIS_SCALE,
      width: w.width / AXIS_SCALE,
      height: w.height / AXIS_SCALE
    }))
  const { left } = axisStrip(img)
  const first = await read({ left, y0: 0, y1: img.height })
  const col = labelColumn(first)
  if (col != null) return read({ left: Math.max(0, col - 8), y0: 0, y1: img.height })
  const out = [...first]
  for (let y = 0; y < img.height; y += 220) {
    for (const w of await read({ left, y0: y, y1: Math.min(img.height, y + 260) }))
      if (!out.some((o) => Math.abs(o.top - w.top) < 4 && Math.abs(o.left - w.left) < 6)) out.push(w)
  }
  return out
}

/**
 * Numbers of the price axis (words in image coordinates). A lost decimal point is put back from the instrument's
 * decimals; a value far from the expected price (`near`, e.g. the entry) is scaled by powers of ten or dropped.
 */
export function axisLabels(words: readonly OcrWord[], opts: { decimals?: number | null; near?: number | null } = {}): AxisLabel[] {
  const texts = words.map((w) => ({ w, raw: w.text.replace(/,/g, '.').replace(/[^0-9.]/g, '') })).filter((t) => /\d/.test(t.raw) && (t.raw.match(/\./g)?.length ?? 0) <= 1)
  // The usual length of a label with a point: a shorter one without it lost its leading digits ("1.12000" → "12000"),
  // and so did one that starts with the point (".12000"). With the expected price and decimals known the full length
  // is known too.
  const dotted = texts.filter((t) => /^\d+\./.test(t.raw)).map((t) => t.raw.replace('.', '').length)
  const expected = opts.near && opts.near > 0 && opts.decimals != null ? String(Math.floor(opts.near)).length + opts.decimals : null
  const usual = dotted.length >= 2 ? mostCommon(dotted) : expected
  const out: AxisLabel[] = []
  for (const { w, raw } of texts) {
    const base = { y: w.top + w.height / 2, x: w.left, conf: w.conf }
    if (raw.startsWith('.') && raw.length > 1) {
      out.push({ ...base, value: NaN, suffix: raw.slice(1), decimals: raw.length - 1 })
      continue
    }
    if (!raw.includes('.') && usual != null && raw.length < usual) {
      out.push({ ...base, value: NaN, suffix: raw })
      continue
    }
    let value = Number(raw)
    if (!raw.includes('.') && opts.decimals && raw.length > opts.decimals) value = Number(`${raw.slice(0, -opts.decimals)}.${raw.slice(-opts.decimals)}`)
    if (!Number.isFinite(value) || value <= 0) continue
    if (opts.near && opts.near > 0) {
      let fixed: number | null = null
      for (let k = -5; k <= 5 && fixed == null; k++) {
        const v = value * 10 ** k
        if (v / opts.near < 1.5 && opts.near / v < 1.5) fixed = Number(v.toPrecision(12))
      }
      if (fixed == null) continue
      value = fixed
    }
    out.push({ ...base, value, ...(raw.includes('.') ? { decimals: raw.split('.')[1]!.length } : {}) })
  }
  return out
}

function mostCommon(xs: readonly number[]): number {
  const c = new Map<number, number>()
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0]![0]
}

/** price = a + b·y through most labels (RANSAC over pairs, then least squares on the inliers). */
export function fitPriceScale(
  read: readonly AxisLabel[],
  opts: { near?: number | null; height?: number; decimals?: number | null } = {}
): PriceScale | null {
  // The axis labels stand in one column; numbers further left (a label on the chart, "60 FVG") are not on the axis.
  const column = read.length ? mostCommon(read.map((l) => Math.round(l.x / 6))) * 6 : 0
  const all = read.filter((l) => Math.abs(l.x - column) <= 14)
  const labels = all.filter((l) => !l.suffix)
  // Hardly any whole label (the leading digits cut off everywhere): the cut ones put next to the expected price stand
  // in for the fit, and are read again from it below.
  const guessed = new Set<AxisLabel>()
  if (labels.length < 3 && opts.near && opts.near > 0)
    for (const l of all) {
      const d = l.decimals ?? opts.decimals
      if (!l.suffix || d == null) continue
      const m = 10 ** l.suffix.length
      const sfx = Number(l.suffix)
      const value = Number(((sfx + m * Math.round((opts.near * 10 ** d - sfx) / m)) * 10 ** -d).toFixed(d))
      const g = { ...l, value, suffix: undefined }
      guessed.add(g)
      labels.push(g)
    }
  // OCR may misread a digit on some labels alike (149 → 145): two consistent groups. The one that puts the trade's
  // price (near) on the picture wins over a larger one that does not.
  const h = opts.height ?? 0
  const plausible = (a: number, b: number) => opts.near == null || !h || ((opts.near - a) / b > -0.25 * h && (opts.near - a) / b < 1.25 * h)
  let best: { inliers: AxisLabel[]; err: number; ok: boolean } | null = null
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const p = labels[i]!
      const q = labels[j]!
      if (Math.abs(q.y - p.y) < 15) continue
      const b = (q.value - p.value) / (q.y - p.y)
      if (!(b < 0)) continue
      const a = p.value - b * p.y
      const tol = Math.abs(b) * 1.6
      const inliers = labels.filter((l) => Math.abs(a + b * l.y - l.value) <= tol)
      if (inliers.length < 2) continue
      const err = inliers.reduce((s, l) => s + Math.abs(a + b * l.y - l.value), 0)
      const ok = inliers.length >= 3 && plausible(a, b)
      const better =
        !best ||
        (ok && !best.ok) ||
        (ok === best.ok && (inliers.length > best.inliers.length || (inliers.length === best.inliers.length && err < best.err)))
      if (better) best = { inliers, err, ok }
    }
  if (!best || best.inliers.length < 2) return null
  let fit = leastSquares(best.inliers)
  if (!fit) return null
  const whole = best.inliers.filter((l) => !guessed.has(l))
  // Labels that lost their leading digits: the value at their height with the digits read at the end.
  const printed = best.inliers.flatMap((l) => (l.decimals != null && !guessed.has(l) ? [l.decimals] : []))
  const decimals = printed.length ? mostCommon(printed) : (opts.decimals ?? Math.max(...decimalsOf(best.inliers), 0))
  const extra: AxisLabel[] = []
  for (const l of all) {
    if (!l.suffix) continue
    const d = l.decimals ?? decimals
    const predicted = fit.a + fit.b * l.y
    const m = 10 ** l.suffix.length
    const sfx = Number(l.suffix)
    const n = Math.round(predicted * 10 ** d)
    const value = Number(((sfx + m * Math.round((n - sfx) / m)) * 10 ** -d).toFixed(d))
    if (Math.abs(value - predicted) <= Math.abs(fit.b) * 1.6) extra.push({ ...l, value, suffix: undefined })
  }
  const pts = [...whole, ...extra]
  if (pts.length < 3) return null
  fit = leastSquares(pts)
  if (!fit) return null
  const { a, b } = fit
  const maxResidualPx = Math.max(...pts.map((l) => Math.abs(a + b * l.y - l.value) / Math.abs(b)))
  return { a, b, n: pts.length, maxResidualPx, labels: [...pts].sort((x, y) => x.y - y.y) }
}

/** Decimals of the axis: the step between neighbouring labels shows them even when they end in zeros (1.12000). */
function decimalsOf(labels: readonly AxisLabel[]): number[] {
  const ys = [...labels].sort((p, q) => p.y - q.y)
  const out: number[] = []
  for (let i = 1; i < ys.length; i++) {
    const step = Math.abs(ys[i]!.value - ys[i - 1]!.value)
    if (step > 0) out.push(Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)) + 1)
  }
  return out
}

function leastSquares(pts: readonly AxisLabel[]): { a: number; b: number } | null {
  const n = pts.length
  const my = pts.reduce((s, l) => s + l.y, 0) / n
  const mv = pts.reduce((s, l) => s + l.value, 0) / n
  const sxy = pts.reduce((s, l) => s + (l.y - my) * (l.value - mv), 0)
  const sxx = pts.reduce((s, l) => s + (l.y - my) ** 2, 0)
  if (!sxx) return null
  const b = sxy / sxx
  if (!(b < 0)) return null
  return { a: mv - b * my, b }
}

export const priceAt = (s: Pick<PriceScale, 'a' | 'b'>, y: number) => s.a + s.b * y
export const yAt = (s: Pick<PriceScale, 'a' | 'b'>, price: number) => (price - s.a) / s.b

/** Left edge of the price axis: the leftmost label (the plot ends a few pixels before it). */
export function plotRight(img: Pick<ChartImage, 'width'>, scale: PriceScale | null): number {
  if (!scale?.labels.length) return img.width - Math.round(img.width * 0.05)
  return Math.max(10, Math.min(...scale.labels.map((l) => l.x)) - 4)
}

// ------------------------------------------------------------------ position tool

/**
 * Colour step of a rectangle edge (L1 over RGB) between the mean colours of two bands a few pixels away on both sides,
 * each band flat. Edges in screenshots are soft (scaling, lossy WebP / JPEG) and the tool draws a thin line on the
 * entry: the bands skip 2 px on each side, so thin lines are not edges and soft edges still are.
 */
const STEP = 28
const FLAT = 24
const MIN_RUN = 30
const GAP = 16

interface Segment {
  y: number
  x0: number
  x1: number
}

/** Mean colour of three pixels along a line and their largest deviation from it. */
function band(img: ChartImage, x: number, y: number, dx: number, dy: number): [number, number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  const px: number[] = []
  for (let k = 0; k < 3; k++) {
    const i = at(img, x + dx * k, y + dy * k)
    px.push(i)
    r += img.data[i]!
    g += img.data[i + 1]!
    b += img.data[i + 2]!
  }
  r /= 3
  g /= 3
  b /= 3
  let spread = 0
  for (const i of px) spread = Math.max(spread, Math.abs(img.data[i]! - r) + Math.abs(img.data[i + 1]! - g) + Math.abs(img.data[i + 2]! - b))
  return [r, g, b, spread]
}

/** Edge between rows above and below y (horizontal = true) or columns left and right of x. */
function isEdge(img: ChartImage, x: number, y: number, horizontal: boolean): boolean {
  const a = horizontal ? band(img, x, y - 5, 0, 1) : band(img, x - 5, y, 1, 0)
  if (a[3] > FLAT) return false
  const b = horizontal ? band(img, x, y + 3, 0, 1) : band(img, x + 3, y, 1, 0)
  if (b[3] > FLAT) return false
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) >= STEP
}

interface EdgeMaps {
  h: Uint8Array
  v: Uint8Array
  width: number
  height: number
}

/** Horizontal and vertical colour steps of the plot (1 = edge). */
function edgeMaps(img: ChartImage, right: number): EdgeMaps {
  const h = new Uint8Array(img.width * img.height)
  const v = new Uint8Array(img.width * img.height)
  for (let y = 6; y < img.height - 6; y++)
    for (let x = 6; x < Math.min(right, img.width - 6); x++) {
      const i = y * img.width + x
      if (isEdge(img, x, y, true)) h[i] = 1
      if (isEdge(img, x, y, false)) v[i] = 1
    }
  return { h, v, width: img.width, height: img.height }
}

interface VEdge {
  x: number
  y0: number
  y1: number
}

/**
 * Long vertical steps that are not the sides of candle bodies (a candle colour right next to them): rectangle edges.
 * Candles crossing an edge break it, so short gaps are bridged.
 */
function verticalEdges(img: ChartImage, m: EdgeMaps, right: number, hues: readonly number[]): VEdge[] {
  const runs: VEdge[] = []
  for (let x = 6; x < Math.min(right, img.width - 6); x++) {
    let start = -1
    let last = -1
    let hits = 0
    const flush = () => {
      if (start >= 0 && last - start + 1 >= 40 && hits / (last - start + 1) >= 0.5) {
        let candle = 0
        let n = 0
        for (let y = start; y <= last; y += Math.max(1, Math.floor((last - start) / 24))) {
          if (!m.v[y * m.width + x]) continue
          n++
          if (isCandle(img, x - 4, y, hues) || isCandle(img, x + 4, y, hues)) candle++
        }
        if (n && candle / n < 0.6) runs.push({ x, y0: start, y1: last })
      }
      start = -1
      hits = 0
    }
    for (let y = 6; y < img.height - 6; y++) {
      if (!m.v[y * m.width + x]) {
        if (start >= 0 && y - last > 30) flush()
        continue
      }
      if (start < 0) start = y
      last = y
      hits++
    }
    flush()
  }
  // One edge flags a few neighbouring columns: one per edge.
  runs.sort((a, b) => a.x - b.x || a.y0 - b.y0)
  const out: Array<VEdge & { xs: number[] }> = []
  for (const r of runs) {
    // Neighbouring columns of one edge, or pieces of one edge cut by candles (same column, a gap between).
    const g = out.find(
      (o) =>
        r.x - o.xs[o.xs.length - 1]! <= 2 &&
        (Math.min(o.y1, r.y1) - Math.max(o.y0, r.y0) > 0.5 * Math.min(o.y1 - o.y0, r.y1 - r.y0) || Math.max(o.y0, r.y0) - Math.min(o.y1, r.y1) <= 150)
    )
    if (g) {
      g.xs.push(r.x)
      g.y0 = Math.min(g.y0, r.y0)
      g.y1 = Math.max(g.y1, r.y1)
    } else out.push({ ...r, xs: [r.x] })
  }
  return out.map((o) => ({ x: o.xs[Math.floor((o.xs.length - 1) / 2)]!, y0: o.y0, y1: o.y1 }))
}

/** Share of rows in [y0, y1] with a vertical step near x (± 3 columns). */
function columnCoverage(m: EdgeMaps, x: number, y0: number, y1: number): number {
  let n = 0
  let hits = 0
  for (let y = Math.max(0, Math.round(y0)); y <= Math.min(m.height - 1, Math.round(y1)); y++) {
    n++
    for (let e = Math.max(0, x - 3); e <= Math.min(m.width - 1, x + 3); e++)
      if (m.v[y * m.width + e]) {
        hits++
        break
      }
  }
  return n ? hits / n : 0
}

/** Share of columns in [x0, x1] with a horizontal step at y (± 1 row). */
function rowCoverage(m: EdgeMaps, y: number, x0: number, x1: number): number {
  if (y < 1 || y >= m.height - 1 || x1 <= x0) return 0
  let n = 0
  for (let x = x0; x <= x1; x++) {
    const i = y * m.width + x
    if (m.h[i] || m.h[i - m.width] || m.h[i + m.width]) n++
  }
  return n / (x1 - x0 + 1)
}

/** Most common colour (quantized) of a rectangle, as [r, g, b]. */
function modeColor(img: ChartImage, x0: number, y0: number, x1: number, y1: number): [number, number, number] | null {
  const counts = new Map<number, number>()
  const stepX = Math.max(1, Math.floor((x1 - x0) / 60))
  const stepY = Math.max(1, Math.floor((y1 - y0) / 60))
  for (let y = y0; y < y1; y += stepY)
    for (let x = x0; x < x1; x += stepX) {
      const i = at(img, x, y)
      const key = ((img.data[i]! >> 3) << 10) | ((img.data[i + 1]! >> 3) << 5) | (img.data[i + 2]! >> 3)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  let best = -1
  let n = 0
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c]
  return best < 0 ? null : [((best >> 10) & 31) << 3, ((best >> 5) & 31) << 3, (best & 31) << 3]
}

const colorGap = (a: [number, number, number] | null, b: [number, number, number] | null) =>
  a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : 0

/**
 * Long / Short Position tools: a pair of vertical edges with the same height and, between them, horizontal edges that
 * do not continue outside – the top, the bottom and at least one inside (the entry split, or the tool's shading of the
 * closed part) with two different fills around it. Largest first.
 */
export function findPositionTools(
  img: ChartImage,
  right = img.width,
  hues: readonly number[] = candleHues(img, right),
  opts: { plotEdges?: boolean } = {}
): ToolBox[] {
  const m = edgeMaps(img, right)
  // A tool running past the plot's left or right edge is closed there by the edge itself.
  const real: Array<VEdge & { virtual?: boolean }> = verticalEdges(img, m, right, hues)
  const edges = opts.plotEdges
    ? [{ x: 6, y0: 6, y1: img.height - 7, virtual: true }, ...real, { x: Math.min(right, img.width) - 7, y0: 6, y1: img.height - 7, virtual: true }]
    : real
  const found: ToolBox[] = []
  for (const L of edges)
    for (const R of edges) {
      if (R.x - L.x < 20 || (L.virtual && R.virtual)) continue
      const one = L.virtual ? R : R.virtual ? L : null
      const lo = one ? one.y0 : Math.max(L.y0, R.y0)
      const hi = one ? one.y1 : Math.min(L.y1, R.y1)
      // Candles at the entry often cut one edge: the other one may be longer.
      if (!one && hi - lo < Math.max(40, 0.35 * Math.max(L.y1 - L.y0, R.y1 - R.y0))) continue
      // Rows over both sides' whole length (one may be cut short by candles).
      const spanLo = one ? one.y0 : Math.min(L.y0, R.y0)
      const spanHi = one ? one.y1 : Math.max(L.y1, R.y1)
      const y0 = Math.max(1, spanLo - 40)
      const y1 = Math.min(img.height - 2, spanHi + 40)
      const inside = (y: number) => rowCoverage(m, y, L.x + 4, R.x - 4)
      const ys: number[] = []
      let prev = -10
      for (let y = y0; y <= y1; y++) {
        const c = inside(y)
        if (c < 0.5) continue
        // Peak of a run of rows.
        if (y - prev <= 4 && ys.length) {
          if (c > inside(ys[ys.length - 1]!)) ys[ys.length - 1] = y
        } else ys.push(y)
        prev = y
      }
      // The top and bottom run across the whole width (two tools side by side are not one rectangle) and close the
      // sides: both vertical edges continue just inside them.
      const spread = (y: number) => {
        const q = (R.x - L.x - 8) / 4
        for (let k = 0; k < 4; k++) if (rowCoverage(m, y, Math.round(L.x + 4 + k * q), Math.round(L.x + 4 + (k + 1) * q)) < 0.25) return false
        return true
      }
      const sides = (ya: number, yb: number) => (L.virtual || columnCoverage(m, L.x, ya, yb) >= 0.6) && (R.virtual || columnCoverage(m, R.x, ya, yb) >= 0.6)
      // A closing edge has both sides along the part it closes (up to the next edge inside, ≤ 60 px), or one clean side
      // when candles or lines hide the other (the entry candle at the left edge).
      const bounded = (ya: number, yb: number) => {
        if (yb - ya < 4) return false
        const l = L.virtual ? 1 : columnCoverage(m, L.x, ya, yb)
        const r = R.virtual ? 1 : columnCoverage(m, R.x, ya, yb)
        return (l >= 0.6 && r >= 0.6) || (Math.max(l, r) >= 0.85 && Math.min(l, r) >= 0.25)
      }
      // Edges inside (the entry split, FVG zones crossing the tool – often at the entry) have the sides on both sides.
      const closing = ys.filter(spread)
      // …and the sides come right up to it (a zone overlapping the tool's edge ends a few pixels past it).
      const reaches = (ya: number, yb: number) => {
        const l = L.virtual ? 1 : columnCoverage(m, L.x, ya, yb)
        const r = R.virtual ? 1 : columnCoverage(m, R.x, ya, yb)
        return (l >= 0.5 && r >= 0.5) || (Math.max(l, r) >= 0.8 && Math.min(l, r) >= 0.2) || Math.max(l, r) >= 0.95
      }
      // A faint corner (a dark fill on the dark background) still closes the tool when the edge stops at the sides:
      // a zone crossing the tool runs on past them.
      const ends = (y: number) =>
        (L.virtual || rowCoverage(m, y, L.x - 30, L.x - 4) < 0.4) && (R.virtual || rowCoverage(m, y, R.x + 4, R.x + 30) < 0.4)
      const near = (y: number, ya: number, yb: number) => {
        if (reaches(ya, yb)) return true
        const l = L.virtual ? 1 : columnCoverage(m, L.x, ya, yb)
        const r = R.virtual ? 1 : columnCoverage(m, R.x, ya, yb)
        return Math.max(l, r) >= 0.7 && ends(y)
      }
      let top: number | null =
        closing.find((y) => {
          const next = ys.find((k) => k > y + 12) ?? y + 64
          return near(y, y + 4, y + 12) && bounded(y + 4, Math.min(next - 4, y + 60)) && !sides(y - 26, y - 4)
        }) ?? null
      let bottom: number | null =
        [...closing].reverse().find((y) => {
          const prev = [...ys].reverse().find((k) => k < y - 12) ?? y - 64
          return near(y, y - 12, y - 4) && bounded(Math.max(prev + 4, y - 60), y - 4) && !sides(y + 4, y + 26)
        }) ?? null
      // The plot's own top / bottom (under the header, over the time axis) runs across the whole width.
      const boundary = (y: number) => (y < img.height * 0.15 || y > img.height * 0.8) && rowCoverage(m, y, 6, right - 7) >= 0.9
      if (top != null && boundary(top)) top = null
      if (bottom != null && boundary(bottom)) bottom = null
      // Only the plot's edge cuts a tool (near the top or bottom of the picture).
      const cutTop = top == null && (one != null || Math.abs(L.y0 - R.y0) <= 8) && spanLo < img.height * 0.15
      const cutBottom = bottom == null && (one != null || Math.abs(L.y1 - R.y1) <= 8) && spanHi > img.height * 0.8
      if (cutTop) top = spanLo
      if (cutBottom) bottom = spanHi
      if (top == null || bottom == null || bottom - top < 20) continue
      const inner = ys.filter((y) => y > top! + 4 && y < bottom! - 4)
      if (!inner.length) continue
      const fills = inner.map((y) =>
        colorGap(modeColor(img, L.x + 3, Math.max(top! + 2, y - 30), R.x - 2, y - 3), modeColor(img, L.x + 3, y + 3, R.x - 2, Math.min(bottom! - 1, y + 30)))
      )
      if (Math.max(...fills) < 24) {
        continue
      }
      const refine = (y: number) => refineEdge(img, L.x, R.x, y, hues)
      top = cutTop ? top : refine(top)
      bottom = cutBottom ? bottom : refine(bottom)
      const box: ToolBox = { left: L.x, right: R.x, top, bottom, inner: inner.map(refine), ...(cutTop ? { cutTop } : {}), ...(cutBottom ? { cutBottom } : {}) }
      // The same rectangle from neighbouring edge pairs: keep the wider match.
      const twin = found.findIndex((f) => Math.abs(f.top - top!) <= 6 && Math.abs(f.bottom - bottom!) <= 6 && Math.abs(f.left - L.x) <= 6 && Math.abs(f.right - R.x) <= 6)
      if (twin >= 0) {
        if (inner.length > found[twin]!.inner.length) found[twin] = box
      } else found.push(box)
    }
  // A tool also contains smaller rectangles (its stop or target part with an edge inside): keep the outer ones.
  const outer = found.filter((t) => !found.some((o) => o !== t && o.left <= t.left + 6 && o.right >= t.right - 6 && o.top <= t.top + 6 && o.bottom >= t.bottom - 6 && (o.bottom - o.top) * (o.right - o.left) > (t.bottom - t.top) * (t.right - t.left)))
  return outer.sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))
}

/** The steepest point of a soft edge near y (median over columns without candles), to a pixel. */
function refineEdge(img: ChartImage, left: number, right: number, y: number, hues: readonly number[]): number {
  const found: number[] = []
  for (let x = left + 4; x <= right - 4; x++) {
    let clear = true
    for (let k = y - 8; k <= y + 8 && clear; k++) if (k >= 0 && k < img.height && isCandle(img, x, k, hues)) clear = false
    if (!clear) continue
    let bestY = y
    let bestG = -1
    for (let k = Math.max(1, y - 6); k <= Math.min(img.height - 2, y + 6); k++) {
      const i = at(img, x, k - 1)
      const j = at(img, x, k + 1)
      const g = Math.abs(img.data[i]! - img.data[j]!) + Math.abs(img.data[i + 1]! - img.data[j + 1]!) + Math.abs(img.data[i + 2]! - img.data[j + 2]!)
      if (g > bestG) [bestG, bestY] = [g, k]
    }
    found.push(bestY)
  }
  if (found.length < 5) return y
  found.sort((a, b) => a - b)
  return found[Math.floor(found.length / 2)]!
}

// ------------------------------------------------------------------ candles

/**
 * The two candle colours (hues) of the chart: the most common saturated, bright hues next to the plain background
 * (inside a filled rectangle, e.g. a blue target zone, the fill itself is bright and saturated) and outside long
 * horizontal lines.
 */
export function candleHues(img: ChartImage, right: number): number[] {
  const bg = modeColor(img, 0, 0, right, img.height)
  if (!bg) return []
  const isBg = (x: number, y: number) => {
    if (x < 0 || x >= right) return false
    const i = at(img, x, y)
    return Math.abs(img.data[i]! - bg[0]) + Math.abs(img.data[i + 1]! - bg[1]) + Math.abs(img.data[i + 2]! - bg[2]) <= 24
  }
  const bins = new Array<number>(72).fill(0)
  for (let y = 0; y < img.height; y += 2) {
    let start = -1
    let runHue = -1
    const hues: number[] = []
    // A run of one saturated, bright hue counts when it is narrow and has the background on both sides (a candle body or
    // wick on the plain chart), not a strip of a filled rectangle next to its edge or a line.
    const flush = (end: number) => {
      if (start >= 0 && end - start <= 40) {
        const left = isBg(start - 1, y) || isBg(start - 2, y) || isBg(start - 3, y)
        const rightBg = isBg(end, y) || isBg(end + 1, y) || isBg(end + 2, y)
        if (left && rightBg) for (const h of hues) bins[Math.floor(h / 5) % 72]!++
      }
      start = -1
      runHue = -1
      hues.length = 0
    }
    for (let x = 0; x < right; x++) {
      const [h, s, v] = hsv(img, x, y)
      const ok = s >= 0.45 && v >= 0.5
      if (!ok || (runHue >= 0 && hueGap(h, runHue) > 12)) flush(x)
      if (ok) {
        if (start < 0) {
          start = x
          runHue = h
        }
        hues.push(h)
      }
    }
    flush(right)
  }
  const smooth = bins.map((_, i) => bins[(i + 71) % 72]! + bins[i]! * 2 + bins[(i + 1) % 72]!)
  const order = smooth.map((v, i) => ({ v, h: i * 5 + 2.5 })).sort((a, b) => b.v - a.v)
  const first = order[0]
  if (!first || first.v === 0) return []
  const second = order.find((o) => hueGap(o.h, first.h) >= 40 && o.v >= first.v * 0.12)
  return second ? [first.h, second.h] : [first.h]
}

type Rgb = [number, number, number]

/** The chart's background and the candles' colours (mean of bright, saturated pixels of each candle hue). */
export function candlePalette(img: ChartImage, right: number, hues: readonly number[]): { bg: Rgb; colors: Rgb[] } | null {
  const bg = modeColor(img, 0, 0, right, img.height)
  if (!bg) return null
  const sums = hues.map(() => [0, 0, 0, 0] as [number, number, number, number])
  for (let y = 0; y < img.height; y += 3)
    for (let x = 0; x < right; x++) {
      const [h, s, v] = hsv(img, x, y)
      if (s < 0.45 || v < 0.5) continue
      const k = hues.findIndex((c) => hueGap(h, c) <= 20)
      if (k < 0) continue
      const i = at(img, x, y)
      const t = sums[k]!
      t[0] += img.data[i]!
      t[1] += img.data[i + 1]!
      t[2] += img.data[i + 2]!
      t[3]++
    }
  const colors = sums.filter((t) => t[3]! > 0).map((t) => [t[0]! / t[3]!, t[1]! / t[3]!, t[2]! / t[3]!] as Rgb)
  return colors.length ? { bg, colors } : null
}

/**
 * A candle seen through a translucent fill F (a tool drawn over the chart) or washed out by lossy compression, which
 * keeps brightness but blurs colour: P − F has the brightness of k·(C − bg) for a candle colour C (k ≈ 0.3…1.25) and
 * at most that much of its colour, in the same direction. White or grey text is too bright, grid lines too faint.
 */
function underFill(p: Rgb, fill: Rgb, palette: { bg: Rgb; colors: Rgb[] }): boolean {
  const luma = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!
  const d = [p[0] - fill[0], p[1] - fill[1], p[2] - fill[2]]
  const ld = luma(d)
  const cd = d.map((x) => x - ld)
  for (const c of palette.colors) {
    const v = [c[0] - palette.bg[0], c[1] - palette.bg[1], c[2] - palette.bg[2]]
    const lv = luma(v)
    if (Math.abs(lv) < 20) continue
    const kl = ld / lv
    if (kl < 0.4 || kl > 1.25) continue
    const cv = v.map((x) => x - lv)
    const cc = cv[0]! * cv[0]! + cv[1]! * cv[1]! + cv[2]! * cv[2]!
    const kc = cc ? Math.max(0, (cd[0]! * cv[0]! + cd[1]! * cv[1]! + cd[2]! * cv[2]!) / cc) : 0
    if (kc > kl + 0.3) continue
    const r = Math.hypot(cd[0]! - kc * cv[0]!, cd[1]! - kc * cv[1]!, cd[2]! - kc * cv[2]!)
    if (r <= 0.35 * Math.sqrt(cc) + 12) return true
  }
  return false
}

function isCandle(img: ChartImage, x: number, y: number, hues: readonly number[], minSaturation = 0.38): boolean {
  const [h, s, v] = hsv(img, x, y)
  return s >= minSaturation && v >= 0.38 && hues.some((c) => hueGap(h, c) <= 38)
}

// ------------------------------------------------------------------ measuring

const round1 = (v: number) => Math.round(v * 10) / 10 + 0

/** MAE / MFE of a trade from one tool on the screenshot. */
export function measureExcursions(img: ChartImage, scale: PriceScale, box: ToolBox, input: ExcursionInput, hues: readonly number[]): Excursion | { error: string } {
  const warnings: string[] = []
  const pip = input.pipSize
  const long = input.direction === 'long'
  // The split nearest to the entry (else the strongest colour change: stop vs target, not the progress shading).
  const entryY = input.entry != null ? yAt(scale, input.entry) : null
  let splitY = box.inner[0]!
  if (entryY != null) splitY = box.inner.reduce((b, y) => (Math.abs(y - entryY) < Math.abs(b - entryY) ? y : b), splitY)
  else {
    let gap = -1
    for (const y of box.inner) {
      const g = colorGap(modeColor(img, box.left + 2, Math.max(box.top + 1, y - 30), box.right - 1, y - 1), modeColor(img, box.left + 2, y + 2, box.right - 1, Math.min(box.bottom, y + 30)))
      if (g > gap) [gap, splitY] = [g, y]
    }
  }
  // An edge above the first / below the last axis label may be the plot's own edge cutting the tool (a header of the
  // same colour as the chart): its price is not the tool's level.
  const labelled = (y: number) => !scale.labels.length || (y >= scale.labels[0]!.y - 2 && y <= scale.labels[scale.labels.length - 1]!.y + 2)
  const edgeTop = box.cutTop || !labelled(box.top) ? null : box.top
  const edgeBottom = box.cutBottom || !labelled(box.bottom) ? null : box.bottom
  const tool = {
    entry: priceAt(scale, splitY),
    stop: (long ? edgeBottom : edgeTop) != null ? priceAt(scale, (long ? edgeBottom : edgeTop)!) : null,
    target: (long ? edgeTop : edgeBottom) != null ? priceAt(scale, (long ? edgeTop : edgeBottom)!) : null
  }
  const pxPips = Math.abs(scale.b) / pip
  const near = (a: number | null, b: number | null) => a == null || b == null || Math.abs(a - b) / pip <= Math.max(1.5, 3 * pxPips)
  if (!near(input.entry, tool.entry)) warnings.push(`Wejście narzędzia (${fmt(tool.entry, pip)}) różni się od wejścia transakcji (${fmt(input.entry!, pip)}).`)
  if (!near(input.stopLoss, tool.stop)) warnings.push(`SL narzędzia (${fmt(tool.stop!, pip)}) różni się od SL transakcji (${fmt(input.stopLoss!, pip)}).`)
  if (!near(input.takeProfit, tool.target)) warnings.push(`Cel narzędzia (${fmt(tool.target!, pip)}) różni się od TP transakcji (${fmt(input.takeProfit!, pip)}).`)

  const entry = input.entry ?? tool.entry
  const stop = input.stopLoss ?? tool.stop
  const target = input.takeProfit ?? tool.target
  // The target closes the measured range only when the trade ended there (else it ran on: partials, a later exit).
  const exitAtTarget = target != null && (input.exitPrice == null || Math.abs(input.exitPrice - target) / pip <= Math.max(1.5, 3 * pxPips))
  const stopY = stop != null ? yAt(scale, stop) : null
  const targetY = target != null ? yAt(scale, target) : null
  const levels = [splitY, stopY, targetY, box.top, box.bottom].filter((v): v is number => v != null)
  const margin = 40
  const yMin = Math.max(0, Math.floor(Math.min(...levels) - margin))
  const yMax = Math.min(img.height - 1, Math.ceil(Math.max(...levels) + margin))
  const x0 = box.left
  const x1 = Math.min(box.right, img.width - 1)

  // Candle pixels in the window: candle-coloured ("strong"), or a candle seen through the tool's fill or washed out by
  // lossy compression ("weak", see underFill) in one vertical run with strong ones; not long horizontal runs (lines
  // across the chart in a candle colour, solid or dotted).
  const scanFrom = Math.max(3, x0 - 60)
  const scanTo = Math.min(img.width - 4, x1 + 60)
  const w = scanTo - scanFrom + 1
  const h = yMax - yMin + 1
  const strong = new Uint8Array(w * h)
  const weak = new Uint8Array(w * h)
  const palette = candlePalette(img, plotRight(img, scale), hues)
  const paletteHsv = (palette?.colors ?? []).map((c) => rgbHsv(c))
  const brightEnough = ([h, , v]: [number, number, number]) => {
    let top = 0
    for (const p of paletteHsv) if (hueGap(h, p[0]) <= 38) top = Math.max(top, p[2])
    return v >= top * 0.6
  }
  // The tool's own sides (a line a bit lighter than its fill, made uneven by lossy compression) are not a wick: the
  // usual colour of each side column, above and below the split, against which a pixel there must stand out.
  const sideColor = new Map<string, Rgb>()
  const sideLine = (x: number, y: number, p: Rgb) => {
    if (Math.min(Math.abs(x - box.left), Math.abs(x - box.right)) > 1 || y < box.top || y > box.bottom) return false
    const upper = y < splitY
    const key = `${x}:${upper}`
    let c = sideColor.get(key)
    if (!c) {
      const ya = Math.round(upper ? box.top : splitY) + 2
      const yb = Math.round(upper ? splitY : box.bottom) - 2
      const ch: number[][] = [[], [], []]
      for (let yy = ya; yy <= yb; yy++) {
        const i = at(img, x, yy)
        for (let j = 0; j < 3; j++) ch[j]!.push(img.data[i + j]!)
      }
      const med = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1]! : 0)
      c = [med(ch[0]!), med(ch[1]!), med(ch[2]!)]
      sideColor.set(key, c)
    }
    return Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 24
  }
  const rgb = (x: number, y: number): Rgb => {
    const i = at(img, x, y)
    return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
  }
  for (let y = yMin; y <= yMax; y++)
    for (let x = scanFrom; x <= scanTo; x++) {
      const k = (y - yMin) * w + (x - scanFrom)
      // Strong: clearly a candle colour (the soft edges of white text on a coloured zone are paler) and about as bright
      // (zones stacked in a candle's colour are as saturated, but dim).
      if (isCandle(img, x, y, hues, 0.5) && brightEnough(hsv(img, x, y))) strong[k] = 1
      else if (palette) {
        // The fill right next to it (the tool's, a zone's, the shading's – it changes along a row); a thin stroke differs
        // from both neighbours (a fill pixel at the tool's side equals one of them).
        const p = rgb(x, y)
        const l = rgb(x - 3, y)
        const r = rgb(x + 3, y)
        const gap = (a: Rgb) => Math.abs(a[0] - p[0]) + Math.abs(a[1] - p[1]) + Math.abs(a[2] - p[2])
        // On the tool's side itself the fill is the mix of both (a wick of the entry candle often stands there).
        const mid: Rgb = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2]
        if (
          Math.min(gap(l), gap(r)) > 20 &&
          (underFill(p, l, palette) || underFill(p, r, palette) || underFill(p, mid, palette)) &&
          !sideLine(x, y, p)
        )
          weak[k] = 1
      }
    }
  for (let y = 0; y < h; y++) {
    let run = -1
    for (let x = 0; x <= w; x++) {
      const c = x < w && strong[y * w + x] === 1
      if (c && run < 0) run = x
      if (!c && run >= 0) {
        if (x - run > 40) for (let k = run; k < x; k++) strong[y * w + k] = 0
        run = -1
      }
    }
  }
  // One pixel tall dashes (a dotted line in a candle colour, a zone's edge): no candle above or below, but next to one.
  {
    const lit = (k: number) => strong[k] === 1 || weak[k] === 1
    const flat: number[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x
        if (!lit(k) || (y > 0 && lit(k - w)) || (y < h - 1 && lit(k + w))) continue
        if ((x > 0 && lit(k - 1)) || (x < w - 1 && lit(k + 1))) flat.push(k)
      }
    for (const k of flat) strong[k] = weak[k] = 0
  }
  // Column extents over the window (wider than the tool: the candles at its edges count whole).
  const colTopAt = new Array<number>(w).fill(Infinity)
  const colBottomAt = new Array<number>(w).fill(-Infinity)
  for (let cx = 0; cx < w; cx++) {
    let run = -1
    let strongs = 0
    const on = (y: number) => y < h && (strong[y * w + cx] === 1 || weak[y * w + cx] === 1)
    for (let y = 0; y <= h; y++) {
      const k = y * w + cx
      const s = y < h && strong[k] === 1
      // A wick may have a gap of a pixel or two (compression noise, a line across it).
      const c = on(y) || (run >= 0 && (on(y + 1) || on(y + 2)))
      if (c && run < 0) {
        run = y
        strongs = 0
      }
      if (s) strongs++
      if (!c && run >= 0) {
        if (y - run >= 3 && strongs >= 2) {
          colTopAt[cx] = Math.min(colTopAt[cx]!, run + yMin)
          colBottomAt[cx] = Math.max(colBottomAt[cx]!, y - 1 + yMin)
        }
        run = -1
      }
    }
  }
  const has = (x: number) => x >= scanFrom && x <= scanTo && Number.isFinite(colTopAt[x - scanFrom]!)
  // The tool's sides are drawn at the bars' times (centres): the bar under a side counts whole.
  let xs = x0
  if (has(x0) || has(x0 - 1)) {
    xs = has(x0) ? x0 : x0 - 1
    while (has(xs - 1) && xs > x0 - 15) xs--
  }
  let xe = x1
  if (has(x1) || has(x1 + 1)) {
    xe = has(x1) ? x1 : x1 + 1
    while (has(xe + 1) && xe < x1 + 15) xe++
  }
  const colTop = (x: number) => colTopAt[x - scanFrom]!
  const colBottom = (x: number) => colBottomAt[x - scanFrom]!
  // Candles = runs of columns with candle pixels; the first one may hold price from before the entry.
  const candleEnd = (x: number) => {
    let e = x
    while (e + 1 <= xe && has(e + 1)) e++
    return e
  }
  // The entry candle: at the tool's left edge or starting right after it.
  let firstEnd = xs - 1
  for (let x = xs; x <= Math.min(xe, x0 + 6); x++)
    if (has(x)) {
      firstEnd = candleEnd(x)
      break
    }
  const from = input.skipEntryCandle ? firstEnd + 1 : xs
  const levelNear = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) / pip <= Math.max(1.5, 3 * pxPips)
  const tradeExit = input.exitPrice == null ? null : levelNear(input.exitPrice, stop) ? 'stop' : levelNear(input.exitPrice, target) ? 'target' : 'other'
  const stopDist = stop != null ? Math.abs(entry - stop) : null
  const targetDist = target != null ? Math.abs(target - entry) : null
  // The entry candle past a level that did not close the trade: that side of it was before the entry (all its columns).
  let entryTop = Infinity
  let entryBottom = -Infinity
  for (let x = xs; x <= firstEnd; x++) {
    if (!has(x)) continue
    entryTop = Math.min(entryTop, colTop(x))
    entryBottom = Math.max(entryBottom, colBottom(x))
  }
  const entryHigh = Number.isFinite(entryTop) ? priceAt(scale, entryTop - 0.5) : null
  const entryLow = Number.isFinite(entryBottom) ? priceAt(scale, entryBottom + 0.5) : null
  const entryAdverse = entryHigh == null || entryLow == null ? 0 : long ? entry - entryLow : entryHigh - entry
  const entryFavourable = entryHigh == null || entryLow == null ? 0 : long ? entryHigh - entry : entry - entryLow
  const preStop = !input.skipEntryCandle && tradeExit != null && tradeExit !== 'stop' && stopDist != null && entryAdverse >= stopDist
  const preTarget = !input.skipEntryCandle && tradeExit != null && tradeExit !== 'target' && targetDist != null && entryFavourable >= targetDist

  let best = { adverse: 0, favourable: 0, maePt: null as { x: number; y: number } | null, mfePt: null as { x: number; y: number } | null }
  let exit: Excursion['exit'] = 'end'
  let exitPt: { x: number; y: number } | null = null
  let lastX = xe
  let any = false
  let stopAt = -1
  for (let x = from; x <= xe; x++) {
    const top = has(x) ? colTop(x) : Infinity
    const bottom = has(x) ? colBottom(x) : -Infinity
    if (!Number.isFinite(top)) {
      if (stopAt >= 0) break
      continue
    }
    any = true
    const high = priceAt(scale, top - 0.5)
    const low = priceAt(scale, bottom + 0.5)
    const adverse = long ? entry - low : high - entry
    const favourable = long ? high - entry : entry - low
    const inEntry = x <= firstEnd
    if (!(inEntry && preStop) && adverse > best.adverse) best = { ...best, adverse, maePt: { x, y: long ? bottom : top } }
    if (!(inEntry && preTarget) && favourable > best.favourable) best = { ...best, favourable, mfePt: { x, y: long ? top : bottom } }
    if (stopAt >= 0) {
      // The rest of the candle that closed the trade (its wick may be further right than the first touching column).
      if (x >= stopAt) break
      continue
    }
    const stopHit = !(inEntry && preStop) && stopY != null && (long ? bottom >= stopY - 0.5 : top <= stopY + 0.5)
    const targetHit = !(inEntry && preTarget) && exitAtTarget && targetY != null && (long ? top <= targetY + 0.5 : bottom >= targetY - 0.5)
    if (stopHit || targetHit) {
      if (stopHit && targetHit) {
        // Both in one candle: the trade's exit price tells which came first.
        const byExit = input.exitPrice != null && stop != null && target != null ? (Math.abs(input.exitPrice - stop) < Math.abs(input.exitPrice - target) ? 'stop' : 'target') : null
        if (!byExit) warnings.push('Świeca wyjścia dotyka i SL, i celu – kolejność nieznana.')
        exit = byExit ?? 'stop'
      } else exit = stopHit ? 'stop' : 'target'
      exitPt = { x, y: exit === 'stop' ? stopY! : targetY! }
      stopAt = candleEnd(x)
      lastX = stopAt
      if (x >= stopAt) break
    }
  }
  if (!any) return { error: 'Nie znaleziono świec w obszarze narzędzia pozycji.' }
  // A level that closed the trade caps the excursion on its side (a wick beyond it happened after the exit).
  if (exit === 'stop' && stop != null) best.adverse = Math.min(best.adverse, Math.abs(entry - stop))
  if (exit === 'target' && target != null) best.favourable = Math.min(best.favourable, Math.abs(target - entry))
  if (exit === 'end' && input.exitPrice != null && stop != null && Math.abs(input.exitPrice - stop) / pip <= Math.max(1.5, 3 * pxPips))
    warnings.push('Transakcja zamknięta na SL, ale na screenie świece nie dochodzą do SL w obszarze narzędzia.')
  if (scale.maxResidualPx > 2) warnings.push('Skala ceny odczytana niepewnie (etykiety osi nie leżą na prostej).')
  if (preStop || preTarget) warnings.push('Świeca wejścia sięga poziomu, który nie zamknął transakcji – ta jej część była przed wejściem i nie jest liczona.')
  const inFirst = (pt: { x: number } | null) => pt != null && pt.x <= firstEnd
  if (!input.skipEntryCandle && (inFirst(best.maePt) || inFirst(best.mfePt)))
    warnings.push(`${inFirst(best.maePt) ? 'MAE' : 'MFE'}${inFirst(best.maePt) && inFirst(best.mfePt) ? ' i MFE' : ''} ze świecy wejścia – jej część mogła być przed wejściem (można ją pominąć).`)
  return {
    maePips: -round1(Math.max(0, best.adverse) / pip),
    mfePips: round1(Math.max(0, best.favourable) / pip),
    exit,
    tool,
    box,
    splitY,
    range: { x0: from, x1: lastX },
    entryCandleEnd: firstEnd,
    points: { mae: best.maePt, mfe: best.mfePt, exit: exitPt },
    warnings
  }
}

function fmt(v: number, pip: number): string {
  const decimals = Math.max(0, Math.round(-Math.log10(pip)) + 1)
  return v.toFixed(decimals)
}

/**
 * The whole analysis: price scale from the axis words, the position tool matching the trade (when there are several,
 * the one whose entry / stop / target are nearest to the trade's), MAE / MFE.
 */
export function analyzeTvScreenshot(img: ChartImage, axisWords: readonly OcrWord[], input: ExcursionInput & { decimals?: number | null }): TvAnalysis {
  const near = input.entry ?? input.stopLoss ?? input.takeProfit
  const scale = fitPriceScale(axisLabels(axisWords, { decimals: input.decimals ?? null, near }), { near, height: img.height, decimals: input.decimals ?? null })
  if (!scale) return { ok: false, error: 'Nie udało się odczytać skali ceny z osi wykresu (prawa krawędź screena).', scale: null }
  const right = plotRight(img, scale)
  const hues = candleHues(img, right)
  if (!hues.length) return { ok: false, error: 'Nie rozpoznano kolorów świec.', scale }
  // The tool of this trade: the entry on an edge inside it, the stop and target on its outer edges on the right sides
  // (a level beyond the picture or past a cut edge is not compared). Pixels per level; with an offset scale (see
  // anchoredScale) only the distances count.
  const cost = (t: ToolBox) => {
    if (input.entry == null) return 0
    const anchored = anchoredScale(scale, t, input, img.height)
    const long = input.direction === 'long'
    const parts: number[] = []
    const ey = yAt(anchored, input.entry)
    parts.push(t.inner.length ? Math.min(...t.inner.map((y) => Math.abs(y - ey))) : 1e4)
    const outer = (price: number | null, side: 'top' | 'bottom') => {
      if (price == null) return
      const y = yAt(anchored, price)
      if (y < 0 || y > img.height) return
      const cut = side === 'top' ? t.cutTop : t.cutBottom
      const edge = side === 'top' ? t.top : t.bottom
      // A cut side matches any level past it, but less surely than a drawn edge.
      if (cut) parts.push(4 + (side === 'top' ? Math.max(0, y - edge) : Math.max(0, edge - y)))
      else parts.push(Math.abs(y - edge))
    }
    outer(input.stopLoss, long ? 'bottom' : 'top')
    outer(input.takeProfit, long ? 'top' : 'bottom')
    return parts.reduce((s, v) => s + v, 0) / parts.length
  }
  const rank = (list: ToolBox[]) => list.map((t) => ({ t, c: cost(t) })).sort((a, b) => a.c - b.c)
  let tools = findPositionTools(img, right, hues)
  let ranked = rank(tools)
  // A tool running past the plot's edge has no side there: only when nothing else matches the trade.
  if (!ranked.length || (input.entry != null && ranked[0]!.c > 8)) {
    const more = findPositionTools(img, right, hues, { plotEdges: true })
    const r2 = rank(more)
    if (r2.length && (!ranked.length || r2[0]!.c < ranked[0]!.c)) [tools, ranked] = [more, r2]
  }
  if (!ranked.length) return { ok: false, error: 'Nie znaleziono narzędzia Long / Short Position na screenie.', scale }
  const box = ranked[0]!.t
  const anchored = anchoredScale(scale, box, input, img.height)
  const r = measureExcursions(img, anchored, box, input, hues)
  if ('error' in r) return { ok: false, error: r.error, scale }
  if (anchored !== scale) r.warnings.push('Etykiety osi odczytane z błędem cyfry – skala dopasowana do wejścia i SL transakcji (odstęp na wykresie się zgadza).')
  if (tools.length > 1 && input.entry == null) r.warnings.push(`Na screenie jest ${tools.length} narzędzi pozycji – wybrano największe.`)
  return { ok: true, ...r, scale: anchored, tools: tools.length }
}

/**
 * OCR may misread one digit on every axis label alike (an 8 as a 6): the slope is right but the scale is shifted by a
 * round amount (0.2, 0.02…) larger than the whole visible price range – only digits shared by all labels can be
 * misread alike. When moving the scale by such an amount puts an edge inside the tool on the trade's entry (and the
 * stop edge, when there is one, on its stop), the scale is moved. A tool drawn a few pips off the trade is not hidden.
 */
function anchoredScale(scale: PriceScale, box: ToolBox, input: ExcursionInput, height = 2000): PriceScale {
  if (input.entry == null) return scale
  const long = input.direction === 'long'
  const yStop = long ? (box.cutBottom ? null : box.bottom) : box.cutTop ? null : box.top
  const px = Math.abs(scale.b)
  let best: { a: number; err: number } | null = null
  for (const y of box.inner) {
    const shift = input.entry - priceAt(scale, y)
    if (Math.abs(shift) < 20 * px) continue
    const unit = 10 ** Math.floor(Math.log10(Math.abs(shift)))
    if (unit < px * height) continue
    const err = Math.abs(shift - Math.round(shift / unit) * unit)
    if (err > 2 * px) continue
    if (input.stopLoss != null && yStop != null && yStop !== y) {
      const slope = (input.stopLoss - input.entry) / (yStop - y)
      // A stop edge that disagrees may be the plot's edge cutting the tool: only a matching one confirms.
      if (Math.abs(slope / scale.b - 1) > 0.05 && Math.abs(yStop - y) * px < Math.abs(input.stopLoss - input.entry) * 0.9) continue
    }
    if (!best || err < best.err) best = { a: scale.a + shift, err }
  }
  return best ? { ...scale, a: best.a } : scale
}

