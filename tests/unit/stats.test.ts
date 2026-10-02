import { describe, expect, it } from 'vitest'
import { equityCurve, summarize } from '@shared/calc/stats'

const series = (rs: number[]) => rs.map((r, i) => ({ r, time: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }))

describe('statystyki', () => {
  const s = summarize(series([2, -1, -1, 0.05, 3, -1]), 0.1)

  it('wygrane / przegrane / BE i win rate bez BE', () => {
    expect([s.wins, s.losses, s.breakevens, s.count]).toEqual([2, 3, 1, 6])
    expect(s.winRate).toBeCloseTo(0.4, 9)
  })

  it('expectancy = średnie R wszystkich zamkniętych (z BE)', () => {
    expect(s.totalR).toBeCloseTo(2.05, 9)
    expect(s.expectancy).toBeCloseTo(2.05 / 6, 9)
  })

  it('profit factor i średnie', () => {
    expect(s.profitFactor).toBeCloseTo(5 / 3, 9)
    expect(s.avgWinR).toBeCloseTo(2.5, 9)
    expect(s.avgLossR).toBeCloseTo(-1, 9)
  })

  it('max drawdown liczony od szczytu krzywej', () => {
    expect(s.maxDrawdownR).toBeCloseTo(2, 9)
    const curve = equityCurve(series([2, -1, -1, 0.05, 3, -1]))
    expect(curve.map((p) => +p.equity.toFixed(2))).toEqual([2, 1, 0, 0.05, 3.05, 2.05])
  })

  it('serie: BE nie przerywa serii', () => {
    expect(s.longestWinStreak).toBe(1)
    expect(s.longestLossStreak).toBe(2)
    expect(s.currentStreak).toBe(-1)
    const t = summarize(series([-1, 0, -1, -1, 1]), 0.1)
    expect(t.longestLossStreak).toBe(3)
  })

  it('kolejność po czasie, nie po kolejności wejścia', () => {
    const shuffled = [
      { r: -1, time: '2026-01-03T00:00:00.000Z' },
      { r: 2, time: '2026-01-01T00:00:00.000Z' },
      { r: -1, time: '2026-01-02T00:00:00.000Z' }
    ]
    expect(summarize(shuffled, 0.1).maxDrawdownR).toBeCloseTo(2, 9)
  })

  it('brak strat → PF nieskończony; brak transakcji → null', () => {
    expect(summarize(series([1, 2]), 0.1).profitFactor).toBe(Number.POSITIVE_INFINITY)
    const empty = summarize([], 0.1)
    expect(empty.expectancy).toBeNull()
    expect(empty.winRate).toBeNull()
    expect(empty.profitFactor).toBeNull()
  })

  it('wydajność: 5000 transakcji < 50 ms', () => {
    const big = series(Array.from({ length: 5000 }, (_, i) => ((i * 7919) % 5) - 1.5)).map((x, i) => ({
      ...x,
      time: new Date(Date.UTC(2020, 0, 1) + i * 3600_000).toISOString()
    }))
    const t0 = performance.now()
    summarize(big, 0.1)
    expect(performance.now() - t0).toBeLessThan(50)
  })
})
