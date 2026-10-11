/**
 * Runs the ICT engine in the window for one symbol: loads closed candles of M15 / H1 / H4 / D from the main
 * process and replays them through the shared engine (pure TS). Phase 2 only needs this on demand for the chart;
 * live signals (phase 3) move the engine to a worker in the main process – same code.
 */
import { useEffect, useState } from 'react'
import type { EngineSnapshot } from '@shared/scanner/detectors/types'
import type { DetectorParams } from '@shared/scanner/detectors/params'
import { analyzeSeries } from '@shared/scanner/engine'
import type { Interval, SeriesCandle } from '@shared/scanner/types'
import { api } from '../../lib/api'

/** Days of closed candles fed to the engine per interval (D needs the IPDA look-backs, M15 only the recent weeks). */
const FEED_DAYS: Partial<Record<Interval, number>> = { M15: 35, H1: 130, H4: 410, D: 410 }

export interface Analysis {
  snapshot: EngineSnapshot
  /** Last closed candle fed, per interval. */
  lastAt: Partial<Record<Interval, number>>
  ms: number
}

export async function loadAnalysis(symbol: string, pipSize: number, params: DetectorParams, nowSec = Math.floor(Date.now() / 1000)): Promise<Analysis> {
  const t0 = performance.now()
  const series: Partial<Record<Interval, SeriesCandle[]>> = {}
  await Promise.all(
    (Object.keys(FEED_DAYS) as Interval[]).map(async (i) => {
      const all = await api.scanner.series(symbol, i, nowSec - FEED_DAYS[i]! * 86400, nowSec + 60)
      // Only closed candles: the one still forming (end in the future) stays out of the detectors.
      series[i] = all.filter((c) => c.end <= nowSec)
    })
  )
  const snapshot = analyzeSeries(series, pipSize, params)
  const lastAt: Partial<Record<Interval, number>> = {}
  for (const [i, list] of Object.entries(series)) if (list?.length) lastAt[i as Interval] = list[list.length - 1]!.t
  return { snapshot, lastAt, ms: Math.round(performance.now() - t0) }
}

/** Analysis of `symbol`, reloaded when the symbol, the parameters or `version` change and every 5 minutes. */
export function useAnalysis(symbol: string, pipSize: number, params: DetectorParams, version: string): Analysis | null {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = () =>
      loadAnalysis(symbol, pipSize, params).then(
        (a) => !cancelled && setAnalysis(a),
        () => !cancelled && setAnalysis(null)
      )
    void load()
    const timer = setInterval(() => void load(), 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [symbol, pipSize, params, version])
  return analysis
}
