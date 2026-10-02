/**
 * Screenshot compression in the renderer (Chromium canvas, no native libraries).
 * Every pasted / dropped image is converted to WebP; the original is never stored.
 */

export type CompressMode = 'auto' | 'lossy' | 'lossless'

export interface CompressOptions {
  mode: CompressMode
  /** 1..100, used for lossy encoding */
  quality: number
  /** auto mode: keep lossless if its size <= ratio x lossy size */
  autoMaxRatio?: number
  maxWidth: number
  thumbWidth: number
  thumbQuality?: number
}

export interface CompressedImage {
  image: Uint8Array
  thumb: Uint8Array
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  originalBytes: number
  originalType: string
  lossless: boolean
}

type Canvas2D = OffscreenCanvas

function makeCanvas(w: number, h: number): Canvas2D {
  return new OffscreenCanvas(w, h)
}

/**
 * Downscale with good quality: halve repeatedly (box-like filtering) while the image is more than
 * twice the target, then one final high-quality resample. Never upscales.
 */
export function resizeTo(source: CanvasImageSource & { width: number; height: number }, targetWidth: number): Canvas2D {
  const srcW = source.width
  const srcH = source.height
  const scale = Math.min(1, targetWidth / srcW)
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  let current: CanvasImageSource & { width: number; height: number } = source
  let cw = srcW
  let ch = srcH
  while (cw / 2 >= w) {
    const nw = Math.round(cw / 2)
    const nh = Math.round(ch / 2)
    const step = makeCanvas(nw, nh)
    const ctx = step.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(current, 0, 0, nw, nh)
    current = step
    cw = nw
    ch = nh
  }
  const out = makeCanvas(w, h)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(current, 0, 0, w, h)
  return out
}

export async function encodeWebp(canvas: Canvas2D, quality01: number): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: quality01 })
  if (blob.type !== 'image/webp') throw new Error('Ta wersja Chromium nie potrafi kodować WebP.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Walk the RIFF/WEBP chunks: a 'VP8L' bitstream is lossless, 'VP8 ' is lossy. */
export function isLosslessWebp(bytes: Uint8Array): boolean {
  const tag = (o: number) => String.fromCharCode(bytes[o] ?? 0, bytes[o + 1] ?? 0, bytes[o + 2] ?? 0, bytes[o + 3] ?? 0)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return false
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    if (id === 'VP8L') return true
    if (id === 'VP8 ') return false
    // Unsigned: a size with the top bit set must not turn negative and loop forever.
    const size = ((bytes[offset + 4] ?? 0) | ((bytes[offset + 5] ?? 0) << 8) | ((bytes[offset + 6] ?? 0) << 16) | ((bytes[offset + 7] ?? 0) << 24)) >>> 0
    offset += 8 + size + (size & 1)
  }
  return false
}

export async function compressImage(blob: Blob, opts: CompressOptions): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    const main = resizeTo(bitmap, Math.min(opts.maxWidth, bitmap.width))
    const lossyQ = Math.min(0.99, Math.max(0.01, opts.quality / 100))
    let image: Uint8Array
    if (opts.mode === 'lossy') image = await encodeWebp(main, lossyQ)
    // Chromium switches the WebP encoder to lossless mode at quality 1.0.
    else if (opts.mode === 'lossless') image = await encodeWebp(main, 1)
    else {
      const [lossless, lossy] = await Promise.all([encodeWebp(main, 1), encodeWebp(main, lossyQ)])
      image = lossless.byteLength <= lossy.byteLength * (opts.autoMaxRatio ?? 1.3) ? lossless : lossy
    }
    const thumbCanvas = main.width > opts.thumbWidth ? resizeTo(main, opts.thumbWidth) : main
    const thumb = await encodeWebp(thumbCanvas, (opts.thumbQuality ?? 80) / 100)
    return {
      image,
      thumb,
      width: main.width,
      height: main.height,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      originalBytes: blob.size,
      originalType: blob.type || 'image',
      lossless: isLosslessWebp(image)
    }
  } finally {
    bitmap.close()
  }
}

export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length === 0) for (const f of Array.from(data.files ?? [])) if (f.type.startsWith('image/')) files.push(f)
  return files
}

export function typeLabel(mime: string): string {
  const t = mime.replace('image/', '').toUpperCase()
  return t === 'JPEG' ? 'JPG' : t || 'obraz'
}
