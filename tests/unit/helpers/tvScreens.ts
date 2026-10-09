/**
 * For tests of the TradingView screenshot reading: a minimal PNG decoder (8-bit RGB / RGBA, not interlaced – the
 * fixtures from scripts/tv-screens.mjs) and the same offline Tesseract as the app's OCR worker, run in-process.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gunzipSync, inflateSync } from 'node:zlib'
import type { ChartImage, GrayImage } from '@shared/import/tvChart'
import { parseTesseractTsv, type OcrWord } from '@shared/import/xtbScreen'

export function decodePng(buf: Buffer): ChartImage {
  let p = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const d = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      width = d.readUInt32BE(0)
      height = d.readUInt32BE(4)
      if (d[8] !== 8 || d[12] !== 0) throw new Error('PNG: only 8-bit, not interlaced')
      colorType = d[9]!
    } else if (type === 'IDAT') idat.push(d)
    p += 12 + len
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!bpp) throw new Error(`PNG: colour type ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const data = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      let v = line[i]!
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 255
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      data[o] = cur[x * bpp]!
      data[o + 1] = cur[x * bpp + 1]!
      data[o + 2] = cur[x * bpp + 2]!
      data[o + 3] = bpp === 4 ? cur[x * bpp + 3]! : 255
    }
    ;[prev, cur] = [cur, prev]
  }
  return { width, height, data }
}

export const loadPng = (path: string) => decodePng(readFileSync(path))

interface Core {
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void }
  TessBaseAPI: new () => {
    Init(dataPath: string, lang: string, oem: number): number
    SetImageFile(exif: number, angle: number): void
    SetVariable(name: string, value: string): boolean
    Recognize(monitor: null): number
    GetTSVText(page: number): string
  }
}

let engine: Promise<{ core: Core; api: InstanceType<Core['TessBaseAPI']> }> | null = null

/** OCR of a grayscale image (as the app reads the axis: PSM and whitelist given). */
export async function ocrGray(gray: GrayImage, psm: number, whitelist: string): Promise<OcrWord[]> {
  engine ??= (async () => {
    const require = createRequire(import.meta.url)
    const createCore = require('tesseract.js-core/tesseract-core-simd-lstm.wasm.js') as () => Promise<Core>
    const core = await createCore()
    const model = require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')
    core.FS.writeFile('/eng.traineddata', gunzipSync(readFileSync(model)))
    const api = new core.TessBaseAPI()
    if (api.Init('/', 'eng', 1) !== 0) throw new Error('Tesseract init')
    return { core, api }
  })()
  const { core, api } = await engine
  // PGM: Tesseract reads it the same as the app's grayscale PNG.
  const header = new TextEncoder().encode(`P5\n${gray.width} ${gray.height}\n255\n`)
  const pgm = new Uint8Array(header.length + gray.lum.length)
  pgm.set(header)
  pgm.set(gray.lum, header.length)
  core.FS.writeFile('/input', pgm)
  api.SetImageFile(1, 0)
  api.SetVariable('tessedit_pageseg_mode', String(psm))
  api.SetVariable('tessedit_char_whitelist', whitelist)
  api.Recognize(null)
  const tsv = api.GetTSVText(0)
  core.FS.unlink('/input')
  return parseTesseractTsv(tsv)
}
