import { describe, expect, it } from 'vitest'
import { forecastFromHistory, monthlyReturns, type MonthReturn } from '@shared/calc/journalReturns'
import type { TradeMetrics } from '@shared/calc/trade'
import { createTrade } from '@shared/defaults'
import type { Trade } from '@shared/schema'

/** Trades with a given R and NY trading date (the metrics are stubbed: only what the monthly returns read). */
function trade(date: string, r: number | null, riskPercent: number | null = null, counts = true): { t: Trade; m: TradeMetrics } {
  const t = { ...createTrade({ pair: 'EURUSD', direction: 'long', entryTime: `${date}T12:00:00.000Z` }), riskPercent }
  return { t, m: { countsInStats: counts, resultR: r, tradingDate: date } as TradeMetrics }
}

function returns(rows: Array<{ t: Trade; m: TradeMetrics }>, defaultRisk = 0.5): MonthReturn[] {
  const byId = new Map(rows.map((x) => [x.t.id, x.m]))
  return monthlyReturns(
    rows.map((x) => x.t),
    (t) => byId.get(t.id)!,
    defaultRisk
  )
}

describe('prognoza z wyników dziennika', () => {
  it('zwrot miesięczny = Σ R × ryzyko %; miesiące bez transakcji między pierwszym a ostatnim = 0%', () => {
    const months = returns([
      trade('2026-01-05', 2, 1), // +2%
      trade('2026-01-20', -1), // −0.5% (default risk)
      trade('2026-03-10', 3, 0.5), // +1.5%
      trade('2026-03-11', null), // no result: not counted
      trade('2026-03-12', 5, 1, false) // missed / open: not counted
    ])
    expect(months).toEqual([
      { month: '2026-01', pct: 1.5, trades: 2 },
      { month: '2026-02', pct: 0, trades: 0 },
      { month: '2026-03', pct: 1.5, trades: 1 }
    ])
    expect(returns([])).toEqual([])
  })

  it('parametry trybu procentowego: zakres miesięcy zyskownych, szansa i wielkość straty (percentyle 10–90)', () => {
    const pcts = [3, 5, -2, 4, 1, -1, 6, 2, 0, 4]
    const months = pcts.map((pct, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, pct, trades: 1 }))
    expect(forecastFromHistory(months)).toEqual({
      months: 10,
      from: '2026-01',
      to: '2026-10',
      mean: 2.2,
      gainLo: 1, // gains sorted 0 1 2 3 4 4 5 6: p10 = v[round(0.7)] = 1, p90 = v[round(6.3)] = 5
      gainHi: 5,
      lossProbability: 20,
      lossLo: 1,
      lossHi: 2
    })
  })

  it('za mało miesięcy – brak parametrów; bez strat – bez miesięcy stratnych', () => {
    expect(forecastFromHistory([{ month: '2026-01', pct: 2, trades: 3 }, { month: '2026-02', pct: 1, trades: 2 }])).toBeNull()
    const gainsOnly = forecastFromHistory([1, 2, 3].map((pct, i) => ({ month: `2026-0${i + 1}`, pct, trades: 1 })))!
    expect(gainsOnly).toMatchObject({ lossProbability: 0, lossLo: null, lossHi: null, gainLo: 1, gainHi: 3, mean: 2 })
  })
})
