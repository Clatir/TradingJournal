/**
 * One instrument, all intervals: closed candles go to the interval engines (M15, H1, H4, D) and to the level
 * sources; every interval can sweep the pools of every other source. Incremental (`push`) and batch
 * (`analyzeSeries`) are the same code path: the batch replays the candles in time order, shorter interval first
 * when several close at the same instant.
 */
import { IntervalEngine } from './detectors/interval'
import { LevelSources, rankPools } from './detectors/levels'
import type { DetectorParams } from './detectors/params'
import type { EngineSnapshot, Pool } from './detectors/types'
import { INTERVAL_ORDER } from './detectors/types'
import type { Interval, SeriesCandle } from './types'

export const ENGINE_INTERVALS: readonly Interval[] = ['M15', 'H1', 'H4', 'D']

export class SymbolEngine {
  readonly engines = new Map<Interval, IntervalEngine>()
  readonly levels: LevelSources

  constructor(
    readonly pipSize: number,
    readonly params: DetectorParams,
    intervals: readonly Interval[] = ENGINE_INTERVALS
  ) {
    for (const i of intervals) this.engines.set(i, new IntervalEngine(i, pipSize, params))
    this.levels = new LevelSources(pipSize, params)
  }

  /** Pools every engine may sweep, except its own (it checks those itself). */
  private externalPools(except: Interval): Pool[] {
    const out: Pool[] = []
    for (const [interval, e] of this.engines) if (interval !== except) for (const p of e.pools) if (p.state === 'untouched') out.push(p)
    for (const p of this.levels.pools) if (p.state === 'untouched') out.push(p)
    return out
  }

  push(interval: Interval, candle: SeriesCandle): void {
    if (interval === 'D') this.levels.pushD(candle)
    if (interval === 'M15') this.levels.pushM15(candle)
    const engine = this.engines.get(interval)
    if (!engine) return
    engine.push(candle, this.externalPools(interval))
  }

  snapshot(): EngineSnapshot {
    const pools: Pool[] = [...this.levels.pools]
    const intervals: EngineSnapshot['intervals'] = {}
    for (const [interval, e] of this.engines) {
      pools.push(...e.pools)
      intervals[interval] = e.objects()
    }
    rankPools(pools, this.params.eqTolerancePips, this.pipSize)
    return { intervals, pools, opens: this.levels.opens, gaps: this.levels.gaps }
  }
}

/** Batch analysis of closed candles per interval (the same engine, replayed in time order). */
export function analyzeSeries(series: Partial<Record<Interval, readonly SeriesCandle[]>>, pipSize: number, params: DetectorParams, intervals: readonly Interval[] = ENGINE_INTERVALS): EngineSnapshot {
  const engine = new SymbolEngine(pipSize, params, intervals)
  const all: Array<{ interval: Interval; candle: SeriesCandle }> = []
  for (const interval of intervals) for (const candle of series[interval] ?? []) all.push({ interval, candle })
  all.sort((a, b) => a.candle.end - b.candle.end || INTERVAL_ORDER[a.interval] - INTERVAL_ORDER[b.interval])
  for (const x of all) engine.push(x.interval, x.candle)
  return engine.snapshot()
}
