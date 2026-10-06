/**
 * Reading an XTB position screenshot: the image is prepared here (canvas) and read by the offline OCR of the main
 * process. Nothing is saved – the image lives only in memory while the dialog is open.
 */
import { mergeXtb, parseTesseractTsv, parseXtbScreen, xtbMissing, type XtbPosition } from '@shared/import/xtbScreen'
import { api } from './api'

/**
 * Passes: enlargement and binarization threshold. The next pass runs only while a needed value is missing or a price
 * was read without its decimal point (small fonts, different text rendering).
 */
const PASSES = [
  { scale: 3, threshold: 200 },
  { scale: 3, threshold: 170 },
  { scale: 4, threshold: 200 },
  { scale: 3, threshold: 225 }
]
/** Largest side of the prepared image (Tesseract likes ~30 px letters; small screenshots are enlarged). */
const MAX_SIDE = 4000

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

/** Black-and-white PNG of the grayscale at a threshold (gray labels become black). */
async function binaryPng(gray: Gray, threshold: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(gray.width, gray.height)
  const g = canvas.getContext('2d')!
  const img = g.createImageData(gray.width, gray.height)
  const d = img.data
  for (let i = 0; i < gray.lum.length; i++) {
    const v = gray.lum[i]! < threshold ? 0 : 255
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
    d[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** The position read from a screenshot (several passes merged); null when no position panel was found. */
export async function readXtbScreenshot(image: Blob, onPass?: (pass: number, total: number) => void): Promise<XtbPosition | null> {
  const grays = new Map<number, Gray>()
  let result: XtbPosition | null = null
  for (let i = 0; i < PASSES.length; i++) {
    const { scale, threshold } = PASSES[i]!
    onPass?.(i + 1, PASSES.length)
    if (!grays.has(scale)) grays.set(scale, await grayscale(image, scale))
    const tsv = await api.ocrImage(await binaryPng(grays.get(scale)!, threshold))
    result = mergeXtb(result, parseXtbScreen(parseTesseractTsv(tsv)))
    if (xtbMissing(result).length === 0 && !result?.undotted.length) break
  }
  return result
}
