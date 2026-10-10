/**
 * Candle store of the scanner, per computer (userData/scanner/candles), never in the synced journal folder: it is a
 * rebuildable cache that grows quickly.
 *
 *   candles/<SYMBOL>/m1/YYYY-MM.bin   M1 bars of one UTC month (stream, REST, TradingView 1m CSV)
 *   candles/<SYMBOL>/h1/YYYY.bin      H1 bars imported from TradingView CSV (WTI history), used where M1 is missing
 *   candles/<SYMBOL>/index.json       coverage: ranges confirmed to hold all data (union per base)
 *
 * Binary file: 16-byte header ("ICTC", u16 version, u16 record size, 8 reserved) + records sorted by time:
 * u32 open time (Unix seconds) + 4 × f64 OHLC = 36 bytes, little endian. A gap = market hours outside the coverage;
 * a minute without a bar inside the coverage is simply a minute without ticks.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../datastore/atomic'
import { aggregate, markIncomplete } from '@shared/scanner/aggregate'
import { marketRanges } from '@shared/scanner/time'
import type { Candle, Interval, Range, SeriesCandle } from '@shared/scanner/types'

export type Base = 'M1' | 'H1'

const MAGIC = 0x43544349 // "ICTC" little endian
const VERSION = 1
const HEADER = 16
const RECORD = 36

export function encodeCandles(candles: readonly Candle[]): Buffer {
  const buf = Buffer.alloc(HEADER + candles.length * RECORD)
  buf.writeUInt32LE(MAGIC, 0)
  buf.writeUInt16LE(VERSION, 4)
  buf.writeUInt16LE(RECORD, 6)
  let off = HEADER
  for (const c of candles) {
    writeRecord(buf, off, c)
    off += RECORD
  }
  return buf
}

function writeRecord(buf: Buffer, off: number, c: Candle): void {
  buf.writeUInt32LE(c.t, off)
  buf.writeDoubleLE(c.o, off + 4)
  buf.writeDoubleLE(c.h, off + 12)
  buf.writeDoubleLE(c.l, off + 20)
  buf.writeDoubleLE(c.c, off + 28)
}

/** Decodes a file; a torn last record (crash during append) is ignored. Returns null for a foreign file. */
export function decodeCandles(buf: Buffer): Candle[] | null {
  if (buf.length < HEADER || buf.readUInt32LE(0) !== MAGIC || buf.readUInt16LE(6) !== RECORD) return null
  const n = Math.floor((buf.length - HEADER) / RECORD)
  const out: Candle[] = new Array(n)
  for (let i = 0, off = HEADER; i < n; i++, off += RECORD) {
    out[i] = {
      t: buf.readUInt32LE(off),
      o: buf.readDoubleLE(off + 4),
      h: buf.readDoubleLE(off + 12),
      l: buf.readDoubleLE(off + 20),
      c: buf.readDoubleLE(off + 28)
    }
  }
  return out
}

/** Union of ranges, sorted, touching ranges merged. */
export function unionRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to)
    else out.push({ from: r.from, to: r.to })
  }
  return out
}

/** Parts of `ranges` not covered by `cover` (both sorted unions). */
export function subtractRanges(ranges: readonly Range[], cover: readonly Range[]): Range[] {
  const out: Range[] = []
  let j = 0
  for (const r of ranges) {
    let from = r.from
    while (j < cover.length && cover[j]!.to <= from) j++
    let k = j
    while (from < r.to) {
      const c = cover[k]
      if (!c || c.from >= r.to) {
        out.push({ from, to: r.to })
        break
      }
      if (c.from > from) out.push({ from, to: c.from })
      from = Math.max(from, c.to)
      k++
    }
  }
  return out
}

/** Merges sorted candle lists by time; with `override` the incoming bar wins on equal times. */
export function mergeCandles(existing: readonly Candle[], incoming: readonly Candle[], override: boolean): Candle[] {
  const out: Candle[] = []
  let i = 0
  let j = 0
  while (i < existing.length || j < incoming.length) {
    const a = existing[i]
    const b = incoming[j]
    if (!b || (a && a.t < b.t)) {
      out.push(a!)
      i++
    } else if (!a || b.t < a.t) {
      out.push(b)
      j++
    } else {
      out.push(override ? b : a)
      i++
      j++
    }
  }
  return out
}

interface IndexFile {
  version: 1
  m1: Range[]
  h1: Range[]
}

function monthKey(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 7)
}

function yearKey(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 4)
}

/** Keys of files that may hold [from, to). */
function fileKeys(base: Base, from: number, to: number): string[] {
  const keys: string[] = []
  const d = new Date(from * 1000)
  if (base === 'M1') {
    let y = d.getUTCFullYear()
    let m = d.getUTCMonth()
    for (;;) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}`
      if (Date.UTC(y, m, 1) / 1000 >= to) break
      keys.push(key)
      m++
      if (m === 12) {
        m = 0
        y++
      }
    }
  } else {
    for (let y = d.getUTCFullYear(); Date.UTC(y, 0, 1) / 1000 < to; y++) keys.push(String(y))
  }
  return keys
}

function lowerBound(c: readonly Candle[], t: number): number {
  let lo = 0
  let hi = c.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (c[mid]!.t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface SymbolUsage {
  symbol: string
  bytes: number
  /** Coverage of M1 data (first / last covered second), null when empty. */
  from: number | null
  to: number | null
}

export class CandleStore {
  private readonly indexes = new Map<string, IndexFile>()
  private readonly dirty = new Set<string>()
  private readonly locks = new Map<string, Promise<unknown>>()
  /** Last bar time per M1 file, for the append fast path. */
  private readonly lastTime = new Map<string, number>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly root: string,
    private readonly saveDelayMs = 5000
  ) {}

  private symbolDir(symbol: string): string {
    if (!/^[A-Z0-9._-]{2,20}$/.test(symbol)) throw new Error(`Nieprawidłowy symbol: ${symbol}`)
    return join(this.root, symbol)
  }

  private filePath(symbol: string, base: Base, key: string): string {
    return join(this.symbolDir(symbol), base === 'M1' ? 'm1' : 'h1', `${key}.bin`)
  }

  /** Serializes work on one file. */
  private async locked<T>(key: string, op: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(op)
    this.locks.set(key, run)
    try {
      return await run
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key)
    }
  }

  private async readFile(path: string): Promise<Candle[]> {
    try {
      return decodeCandles(await fs.readFile(path)) ?? []
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  /** Merges bars into the store (REST, CSV, late stream bars). `override`: incoming wins on equal times. */
  async write(symbol: string, base: Base, candles: readonly Candle[], override: boolean): Promise<number> {
    const groups = new Map<string, Candle[]>()
    for (const c of candles) {
      const key = base === 'M1' ? monthKey(c.t) : yearKey(c.t)
      const g = groups.get(key)
      if (g) g.push(c)
      else groups.set(key, [c])
    }
    let written = 0
    for (const [key, group] of groups) {
      group.sort((a, b) => a.t - b.t)
      const path = this.filePath(symbol, base, key)
      await this.locked(path, async () => {
        const existing = await this.readFile(path)
        const merged = mergeCandles(existing, group, override)
        await writeFileAtomic(path, encodeCandles(merged))
        if (base === 'M1') this.lastTime.set(path, merged.at(-1)?.t ?? -1)
        written += group.length
      })
    }
    return written
  }

  /** Live M1 bar: appended to the month file when newer than its last bar, merged otherwise. */
  async appendLive(symbol: string, candle: Candle): Promise<void> {
    const path = this.filePath(symbol, 'M1', monthKey(candle.t))
    const appended = await this.locked(path, async () => {
      let last = this.lastTime.get(path)
      if (last === undefined) last = await this.loadLastTime(path)
      if (candle.t <= last) return false
      if (last < 0) {
        await fs.mkdir(join(this.symbolDir(symbol), 'm1'), { recursive: true })
        await fs.writeFile(path, encodeCandles([candle]))
      } else {
        const rec = Buffer.alloc(RECORD)
        writeRecord(rec, 0, candle)
        await fs.appendFile(path, rec)
      }
      this.lastTime.set(path, candle.t)
      return true
    })
    if (!appended) await this.write(symbol, 'M1', [candle], true)
  }

  /** Last bar time of a file (−1 when missing); trims a torn last record left by a crash. */
  private async loadLastTime(path: string): Promise<number> {
    let handle: fs.FileHandle
    try {
      handle = await fs.open(path, 'r+')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return -1
      throw e
    }
    try {
      const { size } = await handle.stat()
      if (size < HEADER) {
        await handle.truncate(0)
        await handle.write(encodeCandles([]))
        return -1
      }
      const whole = HEADER + Math.floor((size - HEADER) / RECORD) * RECORD
      if (whole !== size) await handle.truncate(whole)
      if (whole === HEADER) return -1
      const buf = Buffer.alloc(4)
      await handle.read(buf, 0, 4, whole - RECORD)
      return buf.readUInt32LE(0)
    } finally {
      await handle.close()
    }
  }

  /** Bars of [from, to). */
  async read(symbol: string, base: Base, from: number, to: number): Promise<Candle[]> {
    const out: Candle[] = []
    for (const key of fileKeys(base, from, to)) {
      const path = this.filePath(symbol, base, key)
      const bars = await this.locked(path, () => this.readFile(path))
      const a = lowerBound(bars, from)
      const b = lowerBound(bars, to)
      for (let i = a; i < b; i++) out.push(bars[i]!)
    }
    return out
  }

  // ---- coverage -------------------------------------------------------------------------------------------------

  private async index(symbol: string): Promise<IndexFile> {
    const cached = this.indexes.get(symbol)
    if (cached) return cached
    let idx: IndexFile = { version: 1, m1: [], h1: [] }
    try {
      const raw = JSON.parse(await fs.readFile(join(this.symbolDir(symbol), 'index.json'), 'utf8')) as Partial<IndexFile>
      const clean = (list: unknown): Range[] =>
        Array.isArray(list)
          ? unionRanges(list.filter((r): r is Range => !!r && Number.isFinite((r as Range).from) && Number.isFinite((r as Range).to)))
          : []
      idx = { version: 1, m1: clean(raw.m1), h1: clean(raw.h1) }
    } catch {
      // Missing or unreadable: no coverage (data will be fetched again, the cache is rebuildable).
    }
    this.indexes.set(symbol, idx)
    return idx
  }

  async coverage(symbol: string, base: Base = 'M1'): Promise<Range[]> {
    const idx = await this.index(symbol)
    return (base === 'M1' ? idx.m1 : idx.h1).map((r) => ({ ...r }))
  }

  async addCoverage(symbol: string, base: Base, range: Range): Promise<void> {
    if (range.to <= range.from) return
    const idx = await this.index(symbol)
    if (base === 'M1') idx.m1 = unionRanges([...idx.m1, range])
    else idx.h1 = unionRanges([...idx.h1, range])
    this.dirty.add(symbol)
    this.scheduleSave()
  }

  /** Market-hours parts of [from, to) without M1 coverage (and, with `orH1`, without imported H1 either). */
  async gaps(symbol: string, from: number, to: number, orH1 = false): Promise<Range[]> {
    const idx = await this.index(symbol)
    const cover = orH1 ? unionRanges([...idx.m1, ...idx.h1]) : idx.m1
    return subtractRanges(marketRanges(from, to), cover)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, this.saveDelayMs)
  }

  /** Writes changed coverage indexes (also called on shutdown). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    for (const symbol of [...this.dirty]) {
      this.dirty.delete(symbol)
      const idx = this.indexes.get(symbol)
      if (!idx) continue
      const path = join(this.symbolDir(symbol), 'index.json')
      await this.locked(path, () => writeFileAtomic(path, `${JSON.stringify(idx)}\n`))
    }
  }

  // ---- series ---------------------------------------------------------------------------------------------------

  /**
   * Candles of `interval` over [from, to) built from M1; for H1 and above, hours without M1 coverage are filled with
   * imported H1 bars. Candles overlapping a gap are marked incomplete.
   */
  async series(symbol: string, interval: Interval, from: number, to: number): Promise<SeriesCandle[]> {
    const m1 = await this.read(symbol, 'M1', from, to)
    if (interval === 'M1' || interval === 'M5' || interval === 'M15') {
      const out = aggregate(m1, interval)
      return markIncomplete(out, await this.gaps(symbol, from, to))
    }
    const fromM1 = aggregate(m1, 'H1')
    const imported = await this.read(symbol, 'H1', from, to)
    let h1: Candle[] = fromM1
    if (imported.length) {
      const idx = await this.index(symbol)
      const hours = new Set(fromM1.map((c) => c.t))
      const extra = imported.filter((c) => !hours.has(c.t) && subtractRanges([{ from: c.t, to: c.t + 3600 }], idx.m1).length > 0)
      h1 = mergeCandles(fromM1, extra, false)
    }
    const out = interval === 'H1' ? (h1 as SeriesCandle[]).map((c) => ({ ...c, end: (c as SeriesCandle).end ?? c.t + 3600 })) : aggregate(h1, interval)
    return markIncomplete(out, await this.gaps(symbol, from, to, true))
  }

  // ---- maintenance ----------------------------------------------------------------------------------------------

  async usage(): Promise<SymbolUsage[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.root)
    } catch {
      return []
    }
    const out: SymbolUsage[] = []
    for (const symbol of names.sort()) {
      let bytes = 0
      for (const sub of ['m1', 'h1']) {
        const dir = join(this.root, symbol, sub)
        for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
          bytes += (await fs.stat(join(dir, f)).catch(() => ({ size: 0 }))).size
        }
      }
      const cov = await this.coverage(symbol).catch(() => [] as Range[])
      out.push({ symbol, bytes, from: cov[0]?.from ?? null, to: cov.at(-1)?.to ?? null })
    }
    return out
  }

  /** Removes cached data of one symbol or of all (rebuildable from EODHD). */
  async clear(symbol?: string): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const targets = symbol ? [symbol] : await fs.readdir(this.root).catch(() => [] as string[])
    for (const s of targets) {
      await fs.rm(join(this.root, s), { recursive: true, force: true })
      this.indexes.delete(s)
      this.dirty.delete(s)
    }
    for (const key of [...this.lastTime.keys()]) {
      if (!symbol || key.startsWith(join(this.root, symbol))) this.lastTime.delete(key)
    }
  }
}
