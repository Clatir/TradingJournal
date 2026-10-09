/**
 * MAE / MFE from a TradingView screenshot: the image is decoded here (canvas), the price axis is read by the offline OCR
 * of the main process, the rest is pure analysis (`@shared/import/tvChart`). Nothing is saved.
 */
import { fileUrl } from '@shared/api'
import { AXIS_OCR, analyzeTvScreenshot, readAxisWords, type ChartImage, type ExcursionInput, type GrayImage, type TvAnalysis } from '@shared/import/tvChart'
import { parseTesseractTsv, type OcrWord } from '@shared/import/xtbScreen'
import { api } from './api'

/** A decoded screenshot with its axis read (enough to measure again with other options without OCR). */
export interface TvScreenRead {
  image: ChartImage
  words: OcrWord[]
}

export async function decodeImage(image: Blob): Promise<ChartImage> {
  const bitmap = await createImageBitmap(image)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const g = canvas.getContext('2d')
    if (!g) throw new Error('Brak kontekstu canvas.')
    g.drawImage(bitmap, 0, 0)
    const { data } = g.getImageData(0, 0, bitmap.width, bitmap.height)
    return { width: bitmap.width, height: bitmap.height, data }
  } finally {
    bitmap.close()
  }
}

async function grayPng(gray: GrayImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(gray.width, gray.height)
  const g = canvas.getContext('2d')!
  const img = g.createImageData(gray.width, gray.height)
  const d = img.data
  for (let i = 0; i < gray.lum.length; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = gray.lum[i]!
    d[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

export async function readTvScreen(image: Blob): Promise<TvScreenRead> {
  const decoded = await decodeImage(image)
  const words = await readAxisWords(decoded, async (gray) => parseTesseractTsv(await api.ocrImage(await grayPng(gray), { ...AXIS_OCR })))
  return { image: decoded, words }
}

/** A saved screen of the journal as a Blob. */
export async function screenBlob(path: string): Promise<Blob> {
  const res = await fetch(fileUrl(path))
  if (!res.ok) throw new Error('Nie udało się wczytać pliku screena.')
  return res.blob()
}

/**
 * Measure the trade on a read screenshot. The tool's target may be the second take profit: when the first one does not
 * match the tool, the second is tried.
 */
export function measureTv(read: TvScreenRead, input: ExcursionInput & { decimals?: number | null }, takeProfit2?: number | null): TvAnalysis {
  const first = analyzeTvScreenshot(read.image, read.words, input)
  if (takeProfit2 == null || takeProfit2 === input.takeProfit || (first.ok && !first.warnings.some((w) => w.startsWith('Cel narzędzia')))) return first
  const second = analyzeTvScreenshot(read.image, read.words, { ...input, takeProfit: takeProfit2 })
  return second.ok && !second.warnings.some((w) => w.startsWith('Cel narzędzia')) ? second : first
}

/** Let the browser paint (a spinner) before a long synchronous step. */
export const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 30))
