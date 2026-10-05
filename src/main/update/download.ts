import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { once } from 'node:events'
import { dirname } from 'node:path'
import { withRetry } from '../datastore/atomic'

/** fetch() of Electron's `net` module in the app (system proxy, Windows certificates); global fetch in tests. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * GET `url` and read its body with `read`. The time limit covers the body too: a server that sends headers and then
 * stalls must not hang the request (the race settles even when the fetch implementation ignores the abort).
 */
async function getBody<T>(fetchFn: FetchLike, url: string, headers: Record<string, string>, timeoutMs: number, read: (res: Response) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      const err = new Error(`Przekroczono limit czasu (${Math.round(timeoutMs / 1000)} s) dla ${url}`)
      err.name = 'AbortError'
      reject(err)
    }, timeoutMs)
  })
  const request = (async () => {
    const res = await fetchFn(url, { headers, signal: ctrl.signal })
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} dla ${url}`)
    return read(res)
  })()
  try {
    return await Promise.race([request, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson(fetchFn: FetchLike, url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<unknown> {
  return getBody(fetchFn, url, headers, timeoutMs, (res) => res.json())
}

export async function fetchText(fetchFn: FetchLike, url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<string> {
  return getBody(fetchFn, url, headers, timeoutMs, (res) => res.text())
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface DownloadOptions {
  /** Abort when no data arrives for this long. */
  stallMs?: number
  onProgress?: (received: number, total: number) => void
  /** Fallback total for progress when the server sends no Content-Length. */
  expectedSize?: number
}

/**
 * Stream `url` into `dest` while hashing it; the file appears under `dest` only when its sha256 matches.
 * A partial download (`dest.part`) is removed on any failure.
 */
export async function downloadVerified(fetchFn: FetchLike, url: string, dest: string, sha256: string, opts: DownloadOptions = {}): Promise<void> {
  const stallMs = opts.stallMs ?? 60_000
  const part = `${dest}.part`
  await fs.mkdir(dirname(dest), { recursive: true })
  const ctrl = new AbortController()
  let stalled = false
  const arm = () =>
    setTimeout(() => {
      stalled = true
      ctrl.abort()
    }, stallMs)
  let stall = arm()
  const touch = () => {
    clearTimeout(stall)
    stall = arm()
  }
  const out = createWriteStream(part)
  const closed = once(out, 'close')
  // A write error (disk full, pendrive removed) also rejects this; it is awaited below.
  closed.catch(() => undefined)
  try {
    const res = await fetchFn(url, { signal: ctrl.signal })
    if (!res.ok || !res.body) throw new HttpError(res.status, `HTTP ${res.status} przy pobieraniu ${url}`)
    const total = Number(res.headers.get('content-length')) || opts.expectedSize || 0
    const hash = createHash('sha256')
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      touch()
      hash.update(value)
      received += value.byteLength
      opts.onProgress?.(received, total)
      if (out.destroyed) throw out.errored ?? new Error('Błąd zapisu pobieranego pliku.')
      if (!out.write(value)) await once(out, 'drain')
    }
    out.end()
    await closed
    const actual = hash.digest('hex')
    if (actual !== sha256.toLowerCase()) throw new Error('Pobrany plik ma inną sumę kontrolną niż wydanie na GitHubie – odrzucono go.')
    // A fresh executable is often held for a moment by the antivirus scan: retry for ~15 s.
    await withRetry(() => fs.rename(part, dest), 35)
  } catch (e) {
    clearTimeout(stall)
    if (!ctrl.signal.aborted) ctrl.abort() // stop the transfer (write error, bad response)
    out.destroy()
    await closed.catch(() => undefined)
    await fs.rm(part, { force: true }).catch(() => undefined)
    if (stalled) throw new Error('Pobieranie przerwane – brak danych z serwera przez dłuższy czas.')
    throw e
  } finally {
    clearTimeout(stall)
  }
}
