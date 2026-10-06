import { describe, expect, it } from 'vitest'
import { createDayPlan, createDefaultJournal } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { hasWellbeing, wellbeingStats } from '@shared/calc/wellbeing'
import type { DayPlan } from '@shared/schema'
import { closedTradeAt } from './helpers/trades'

const day = (date: string, w: Partial<DayPlan['wellbeing']>): DayPlan => {
  const d = createDayPlan(date, [], [])
  return { ...d, wellbeing: { ...d.wellbeing, ...w } }
}

describe('samopoczucie a wynik', () => {
  it('grupy snu, energii i stresu: dni, transakcje, win rate, średnie R, odsetek z błędem', () => {
    const journal = createDefaultJournal()
    const ctx = metricsContext(journal.settings)
    const tag = journal.dictionaries.mistakeTags[0]!.id
    const days = [day('2026-10-05', { sleepHours: 5.5, energy: 2, stress: 4 }), day('2026-10-06', { sleepHours: 7.5, energy: 4, stress: 2 }), day('2026-10-07', {})]
    const trades = [
      closedTradeAt('2026-10-05T12:00:00.000Z', -1, { psychology: { ...closedTradeAt('2026-10-05T12:00:00.000Z', 0).psychology, mistakeTagIds: [tag] } }),
      closedTradeAt('2026-10-05T14:00:00.000Z', 1),
      closedTradeAt('2026-10-06T12:00:00.000Z', 2),
      closedTradeAt('2026-10-07T12:00:00.000Z', 3) // a day without the check
    ]
    const rows = trades.map((trade) => ({ trade, m: tradeMetrics(trade, ctx) }))
    const st = wellbeingStats(days, rows)
    expect(st.daysFilled).toBe(2)
    expect(st.sleep.map((g) => [g.label, g.days, g.trades, g.winRate, g.avgR == null ? null : Number(g.avgR.toFixed(6)) + 0, g.mistakes])).toEqual([
      ['< 6 h', 1, 2, 0.5, 0, 0.5],
      ['6–7 h', 0, 0, null, null, null],
      ['7–8 h', 1, 1, 1, 2, 0],
      ['≥ 8 h', 0, 0, null, null, null]
    ])
    expect(st.energy.map((g) => [g.label, g.days])).toEqual([
      ['niska (1–2)', 1],
      ['średnia (3)', 0],
      ['wysoka (4–5)', 1]
    ])
    expect(st.stress[2]).toMatchObject({ label: 'wysoka (4–5)', days: 1, trades: 2 })
    expect(wellbeingStats(days, rows, { from: '2026-10-06' }).daysFilled).toBe(1)
    expect([hasWellbeing(days[0]!), hasWellbeing(days[2]!)]).toEqual([true, false])
  })
})

describe('mapa godzin: dzień tygodnia × godzina NY', () => {
  it('liczba, Σ R, średnie R, win rate, błędy; zakres godzin', async () => {
    const { weekdayHourCells, cellValue, hourRange } = await import('@shared/calc/heatmap')
    const { validateTrade } = await import('@shared/calc/validator')
    const journal = createDefaultJournal()
    const ctx = metricsContext(journal.settings)
    const tag = journal.dictionaries.mistakeTags[0]!.id
    // Monday 05.10.2026: 07:30 and 07:45 NY (11:30Z, 11:45Z), Tuesday 03:10 NY.
    const trades = [
      closedTradeAt('2026-10-05T11:30:00.000Z', 2),
      closedTradeAt('2026-10-05T11:45:00.000Z', -1, { psychology: { ...closedTradeAt('2026-10-05T11:45:00.000Z', 0).psychology, mistakeTagIds: [tag] } }),
      closedTradeAt('2026-10-06T07:10:00.000Z', 0)
    ]
    const rows = trades.map((trade) => {
      const m = tradeMetrics(trade, ctx)
      return { trade, m, v: validateTrade(trade, m, journal.settings, null) }
    })
    const cells = weekdayHourCells(rows)
    const mon7 = cells.get('1:7')!
    expect(mon7).toMatchObject({ weekday: 1, hour: 7, count: 2, wins: 1, losses: 1 })
    expect(cellValue(mon7, 'totalR')).toBeCloseTo(1, 9)
    expect(cellValue(mon7, 'avgR')).toBeCloseTo(0.5, 9)
    expect(cellValue(mon7, 'winRate')).toBe(0.5)
    expect(cellValue(mon7, 'mistakes')).toBeGreaterThanOrEqual(1)
    expect(cellValue(cells.get('2:3')!, 'winRate')).toBeNull() // only a BE
    expect(hourRange(cells)).toEqual([2, 7]) // 03–07 widened to 6 hours
    expect(hourRange(new Map())).toEqual([0, 23])
  })
})
