/**
 * Offline OCR for screenshots (XTB position details): a worker thread with Tesseract, started on first use and
 * stopped after a minute without work. Nothing leaves the computer and the image is not stored.
 */
import { readFile } from 'node:fs/promises'
import type { Worker } from 'node:worker_threads'
import createWorker from './worker?nodeWorker'
import modelPath from '../../../node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?asset'
import type { OcrReply, OcrRequest } from './worker'
import { log } from '../log'

const IDLE_MS = 60_000
const TIMEOUT_MS = 60_000

let worker: Worker | null = null
let starting: Promise<Worker> | null = null
let idle: NodeJS.Timeout | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (tsv: string) => void; reject: (e: Error) => void }>()

function stop(): void {
  const w = worker
  worker = null
  if (w) void w.terminate()
  for (const [, p] of waiting) p.reject(new Error('OCR został zatrzymany.'))
  waiting.clear()
}

function start(): Promise<Worker> {
  if (worker) return Promise.resolve(worker)
  starting ??= launch().finally(() => (starting = null))
  return starting
}

async function launch(): Promise<Worker> {
  const model = new Uint8Array(await readFile(modelPath))
  const w = createWorker({})
  w.on('message', (msg: OcrReply) => {
    const p = waiting.get(msg.id)
    if (!p) return
    waiting.delete(msg.id)
    if ('error' in msg) p.reject(new Error(msg.error))
    else p.resolve(msg.tsv)
  })
  w.on('error', (e) => {
    log('error', 'OCR worker', e)
    if (worker === w) stop()
  })
  w.on('exit', () => {
    if (worker === w) stop()
  })
  w.postMessage({ kind: 'init', model } satisfies OcrRequest, [model.buffer])
  worker = w
  return w
}

/** Words of a PNG image as Tesseract TSV. */
export async function ocrImage(png: Uint8Array): Promise<string> {
  if (idle) clearTimeout(idle)
  const w = await start()
  const id = nextId++
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error('OCR trwał zbyt długo.'))
      }, TIMEOUT_MS)
      waiting.set(id, {
        resolve: (tsv) => (clearTimeout(timer), resolve(tsv)),
        reject: (e) => (clearTimeout(timer), reject(e))
      })
      const image = new Uint8Array(png)
      w.postMessage({ kind: 'read', id, image } satisfies OcrRequest, [image.buffer])
    })
  } finally {
    if (idle) clearTimeout(idle)
    idle = setTimeout(stop, IDLE_MS)
    idle.unref()
  }
}

export function stopOcr(): void {
  if (idle) clearTimeout(idle)
  stop()
}
