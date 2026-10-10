/**
 * Fills the candle store from EODHD REST: gaps (market hours without coverage) are fetched in stages – the last 14 days
 * first (the scanner can start), then 120 days, then the full depth. REST bars replace stream bars of the same minute.
 * Recent data may not be final yet: coverage then ends at the last bar received and the rest stays a gap to retry.
 */
import { isMarketOpen } from '@shared/scanner/time'
import type { Range } from '@shared/scanner/types'
import { INTRADAY_1M_MAX_SECONDS } from '@shared/scanner/eodhd'
import { EodhdError, type EodhdRest } from './eodhd/rest'
import type { CandleStore } from './store'
import type { BackfillProgress } from '@shared/scanner/api'

export interface BackfillTarget {
  symbol: string
  /** REST code; null = no REST history (skipped). */
  rest: string | null
  depthDays: number
}

export type { BackfillProgress }

export const BACKFILL_STAGES = [14, 120, Infinity] as const
const DAY = 86400

/** Groups gaps into request ranges of at most `max` seconds (covered minutes in between are fetched again). */
export function requestRanges(gaps: readonly Range[], max = INTRADAY_1M_MAX_SECONDS): Range[] {
  const out: Range[] = []
  for (const g of gaps) {
    const last = out[out.length - 1]
    if (last && g.to - last.from <= max) last.to = Math.max(last.to, g.to)
    else {
      for (let a = g.from; a < g.to; a += max) out.push({ from: a, to: Math.min(g.to, a + max) })
    }
  }
  return out
}

export interface BackfillOptions {
  store: CandleStore
  rest: EodhdRest
  now?: () => number
  onProgress?: (p: BackfillProgress) => void
  log?: (message: string) => void
  /** Data newer than this many days may be incomplete on EODHD's side. */
  recentDays?: number
}

export class Backfill {
  private progress: BackfillProgress = { running: false, stage: 0, stages: BACKFILL_STAGES.length, symbol: null, done: 0, total: 0, errors: {}, finishedAt: null }
  private cancelled = false
  private current: Promise<void> | null = null

  constructor(private readonly o: BackfillOptions) {}

  private now(): number {
    return Math.floor((this.o.now ?? Date.now)() / 1000)
  }

  state(): BackfillProgress {
    return { ...this.progress, errors: { ...this.progress.errors } }
  }

  private emit(patch: Partial<BackfillProgress>): void {
    this.progress = { ...this.progress, ...patch }
    this.o.onProgress?.(this.state())
  }

  cancel(): void {
    this.cancelled = true
  }

  /** Runs all stages; a second call while running waits for the running one. */
  run(targets: readonly BackfillTarget[]): Promise<void> {
    if (this.current) return this.current
    this.cancelled = false
    this.current = this.runStages(targets).finally(() => {
      this.current = null
    })
    return this.current
  }

  private async runStages(targets: readonly BackfillTarget[]): Promise<void> {
    const withRest = targets.filter((t) => t.rest)
    this.emit({ running: true, errors: {}, finishedAt: null })
    try {
      for (let s = 0; s < BACKFILL_STAGES.length && !this.cancelled; s++) {
        const nowSec = this.now()
        const to = Math.floor(nowSec / 60) * 60
        const plan: Array<{ target: BackfillTarget; range: Range }> = []
        for (const target of withRest) {
          const days = Math.min(BACKFILL_STAGES[s]!, target.depthDays)
          const gaps = await this.o.store.gaps(target.symbol, to - days * DAY, to)
          for (const range of requestRanges(gaps)) plan.push({ target, range })
        }
        this.emit({ stage: s + 1, done: 0, total: plan.length })
        for (const item of plan) {
          if (this.cancelled) break
          this.emit({ symbol: item.target.symbol })
          const fatal = await this.fetchOne(item.target, item.range)
          this.emit({ done: this.progress.done + 1 })
          if (fatal) return
        }
      }
    } finally {
      this.emit({ running: false, symbol: null, finishedAt: Date.now() })
    }
  }

  /** Returns true when the whole run must stop (no key, rejected key, daily limit, no network). */
  private async fetchOne(target: BackfillTarget, range: Range): Promise<boolean> {
    try {
      const { candles } = await this.o.rest.intraday(target.rest!, range)
      const bars = candles.filter((c) => isMarketOpen(c.t))
      if (bars.length) await this.o.store.write(target.symbol, 'M1', bars, true)
      const recent = this.now() - (this.o.recentDays ?? 3) * DAY
      const last = bars.at(-1)
      if (range.to <= recent) await this.o.store.addCoverage(target.symbol, 'M1', range)
      else if (last) await this.o.store.addCoverage(target.symbol, 'M1', { from: range.from, to: Math.min(range.to, last.t + 60) })
      if (this.progress.errors[target.symbol]) {
        const errors = { ...this.progress.errors }
        delete errors[target.symbol]
        this.emit({ errors })
      }
      return false
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.o.log?.(`backfill ${target.symbol}: ${message}`)
      this.emit({ errors: { ...this.progress.errors, [target.symbol]: message } })
      return e instanceof EodhdError && ['no-key', 'auth', 'daily-limit', 'network'].includes(e.kind)
    }
  }
}
