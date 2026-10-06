/**
 * Reading an XTB position screenshot: the image is prepared here (canvas) and read by the offline OCR of the main
 * process. Nothing is saved – the image lives only in memory while the dialog is open.
 *
 * Three readings are combined (`combineXtb`): the panel binarized (gray labels found best → layout), the panel in
 * gray (digits keep their shapes), and every value and the symbol cut out and read again with only its characters
 * allowed. Each value takes the reading most of them agree on; disagreements are shown for checking.
 */
import {
  cleanSymbol,
  combineXtb,
  parseTesseractTsv,
  parseXtbScreen,
  positionFromTexts,
  valueCharset,
  type Region,
  type XtbField,
  type XtbPosition
} from '@shared/import/xtbScreen'
import { api } from './api'

/** Enlargement (Tesseract likes ~30 px letters) and the largest side of the prepared image. */
const SCALE = 3
const MAX_SIDE = 4000
/** Binarization thresholds for finding the labels (the next one only when no panel was found). */
const LAYOUT_THRESHOLDS = [200, 170, 225]
const TIME_KEYS = new Set(['openTime', 'closeTime'])

interface Gray {
  width: number
  height: number
  lum: Float32Array
}

/** Enlarged grayscale with dark text on white (a dark theme is inverted), contrast stretched. */
async function grayscale(image: Blob, enlarge: number): Promise<Gray> {
  const bitmap = await createImageBitmap(image)
  try {
    const scale = Math.max(1, Math.min(enlarge, MAX_SIDE / Math.max(bitmap.width, bitmap.height)))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = new OffscreenCanvas(width, height)
    const g = canvas.getContext('2d')
    if (!g) throw new Error('Brak kontekstu canvas.')
    g.imageSmoothingQuality = 'high'
    g.drawImage(bitmap, 0, 0, width, height)
    const px = g.getImageData(0, 0, width, height).data
    const n = width * height
    const lum = new Float32Array(n)
    let dark = 0
    for (let i = 0; i < n; i++) {
      const l = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!
      lum[i] = l
      if (l < 70) dark++
    }
    // Dark theme (XTB default): light text on a dark panel → invert.
    const invert = dark > n * 0.3
    const hist = new Uint32Array(256)
    for (let i = 0; i < n; i++) {
      if (invert) lum[i] = 255 - lum[i]!
      hist[Math.round(lum[i]!)]!++
    }
    // Stretch: the darkest 1% → black, the lightest 30% (background) → white.
    let acc = 0
    let lo = 0
    let hi = 255
    for (let v = 0; v < 256; v++) if ((acc += hist[v]!) > n * 0.01) { lo = v; break }
    acc = 0
    for (let v = 255; v >= 0; v--) if ((acc += hist[v]!) > n * 0.3) { hi = v; break }
    const span = Math.max(1, hi - lo)
    for (let i = 0; i < n; i++) lum[i] = Math.max(0, Math.min(255, ((lum[i]! - lo) / span) * 255))
    return { width, height, lum }
  } finally {
    bitmap.close()
  }
}

/** PNG of the grayscale, black and white at a threshold (gray labels become black); 0 = kept gray. */
async function binaryPng(gray: Gray, threshold: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(gray.width, gray.height)
  const g = canvas.getContext('2d')!
  const img = g.createImageData(gray.width, gray.height)
  const d = img.data
  for (let i = 0; i < gray.lum.length; i++) {
    const l = gray.lum[i]!
    const v = threshold ? (l < threshold ? 0 : 255) : l
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
    d[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** A value cut out of the grayscale with a margin and a white border (Tesseract reads lines better with space). */
async function cropPng(gray: Gray, r: Region): Promise<Uint8Array> {
  const pad = Math.round(r.height * 0.35)
  const x0 = Math.max(0, Math.floor(r.left - pad))
  const y0 = Math.max(0, Math.floor(r.top - pad))
  const x1 = Math.min(gray.width, Math.ceil(r.left + r.width + pad))
  const y1 = Math.min(gray.height, Math.ceil(r.top + r.height + pad))
  const border = Math.round(r.height * 0.5)
  const w = x1 - x0 + 2 * border
  const h = y1 - y0 + 2 * border
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')!
  const img = g.createImageData(w, h)
  const d = img.data
  d.fill(255)
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = ((y - y0 + border) * w + (x - x0 + border)) * 4
      d[o] = d[o + 1] = d[o + 2] = gray.lum[y * gray.width + x]!
    }
  g.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

const read = async (png: Uint8Array) => parseXtbScreen(parseTesseractTsv(await api.ocrImage(png)))

/** The position read from a screenshot (readings combined); null when no position panel was found. */
export async function readXtbScreenshot(image: Blob, onStep?: (step: string) => void): Promise<XtbPosition | null> {
  onStep?.('szukam pól')
  const gray = await grayscale(image, SCALE)
  let layout: XtbPosition | null = null
  for (const threshold of LAYOUT_THRESHOLDS) {
    layout = await read(await binaryPng(gray, threshold))
    if (layout) break
  }
  onStep?.('czytam wartości')
  const grayRead = await read(await binaryPng(gray, 0))
  if (!layout && !grayRead) return null

  onStep?.('sprawdzam każdą wartość osobno')
  const regions = { ...grayRead?.regions, ...layout?.regions }
  const texts: Partial<Record<XtbField, string>> = {}
  let symbol: string | null = null
  for (const [key, region] of Object.entries(regions) as Array<[XtbField | 'symbol', Region]>) {
    if (key === 'type') continue
    const tsv = await api.ocrImage(await cropPng(gray, region), { psm: TIME_KEYS.has(key) ? 6 : 7, whitelist: valueCharset(key) })
    const text = parseTesseractTsv(tsv)
      .map((w) => w.text)
      .join(' ')
    if (key === 'symbol') symbol = cleanSymbol(text)
    else texts[key] = text
  }
  const crops = positionFromTexts(texts, { symbol, direction: null })
  return combineXtb([
    { position: crops, weight: 1.2 },
    { position: grayRead, weight: 1 },
    { position: layout, weight: 0.9 }
  ])
}
