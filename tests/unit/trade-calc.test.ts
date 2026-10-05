import { describe, expect, it } from 'vitest'
import { createTrade, DEFAULT_PAIRS, defaultKillzones } from '@shared/defaults'
import { classifyOutcome, pipsBetween, riskReward, tradeMetrics, type MetricsContext } from '@shared/calc/trade'
import type { Trade } from '@shared/schema'

const ctx: MetricsContext = {
  pairs: [...DEFAULT_PAIRS, { symbol: 'USDJPY', pipSize: 0.01, priceDecimals: 3, quoteCurrency: 'JPY', tvSymbol: '', archived: false }],
  killzones: defaultKillzones(),
  breakevenThresholdR: 0.1
}

function trade(p: Omit<Partial<Trade>, 'prices'> & { prices: Partial<Trade['prices']> }, exits: Array<[number | null, number]>): Trade {
  const { prices, ...rest } = p
  return createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime: '2026-07-15T07:30:00.000Z',
    ...rest,
    prices: { entry: prices.entry ?? null, stopLoss: prices.stopLoss ?? null, takeProfit1: prices.takeProfit1 ?? null, takeProfit2: prices.takeProfit2 ?? null },
    exits: exits.map(([price, percent], i) => ({ id: `01J00000000000000000000EX${i}`, time: null, price, percent, note: '' }))
  })
}

describe('pipsy', () => {
  it('EURUSD: 0.0001 = 1 pips', () => {
    expect(pipsBetween(1.085, 1.0835, 0.0001)).toBeCloseTo(-15, 9)
    expect(pipsBetween(1.0835, 1.088, 0.0001)).toBeCloseTo(45, 9)
  })
  it('para JPY z pipSize 0.01', () => {
    const t = trade({ pair: 'USDJPY', prices: { entry: 150.0, stopLoss: 149.8 } }, [[150.4, 100]])
    const m = tradeMetrics(t, ctx)
    expect(m.riskPips).toBeCloseTo(20, 9)
    expect(m.resultPips).toBeCloseTo(40, 9)
    expect(m.resultR).toBeCloseTo(2, 9)
  })
})

describe('R i R:R', () => {
  it('long: SL 15 pips, TP1 2:1, wyjście na TP1 = +2R, +30 pips', () => {
    const t = trade({ prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: 1.088, takeProfit2: 1.0895 } }, [[1.088, 100]])
    const m = tradeMetrics(t, ctx)
    expect(m.riskPips).toBeCloseTo(15, 9)
    expect(m.rrTp1).toBeCloseTo(2, 9)
    expect(m.rrTp2).toBeCloseTo(3, 9)
    expect(m.resultR).toBeCloseTo(2, 9)
    expect(m.resultPips).toBeCloseTo(30, 9)
    expect(m.outcome).toBe('win')
  })

  it('short: zysk gdy cena spada', () => {
    const t = trade({ direction: 'short', prices: { entry: 1.27, stopLoss: 1.272 } }, [[1.266, 100]])
    const m = tradeMetrics(t, ctx)
    expect(m.resultR).toBeCloseTo(2, 9)
    expect(m.resultPips).toBeCloseTo(40, 9)
  })

  it('short: stop = -1R', () => {
    const t = trade({ direction: 'short', prices: { entry: 1.27, stopLoss: 1.272 } }, [[1.272, 100]])
    expect(tradeMetrics(t, ctx).resultR).toBeCloseTo(-1, 9)
    expect(tradeMetrics(t, ctx).outcome).toBe('loss')
  })

  it('partiale: 50% na +2R, 50% na BE = +1R', () => {
    const t = trade({ prices: { entry: 1.1, stopLoss: 1.099 } }, [
      [1.102, 50],
      [1.1, 50]
    ])
    const m = tradeMetrics(t, ctx)
    expect(m.resultR).toBeCloseTo(1, 9)
    expect(m.resultPips).toBeCloseTo(10, 9)
    expect(m.percentMismatch).toBe(false)
  })

  it('partiale 30/30/40', () => {
    const t = trade({ prices: { entry: 1.1, stopLoss: 1.099 } }, [
      [1.101, 30],
      [1.102, 30],
      [1.104, 40]
    ])
    expect(tradeMetrics(t, ctx).resultR).toBeCloseTo(0.3 + 0.6 + 1.6, 9)
  })

  it('zamknięta z partialami sumującymi się do 50% – normalizacja i flaga', () => {
    const t = trade({ prices: { entry: 1.1, stopLoss: 1.099 } }, [[1.102, 50]])
    const m = tradeMetrics(t, ctx)
    expect(m.resultR).toBeCloseTo(2, 9)
    expect(m.percentMismatch).toBe(true)
  })

  it('otwarta pozycja: wynik zrealizowany częściowo, bez klasyfikacji', () => {
    const t = trade({ status: 'open', prices: { entry: 1.1, stopLoss: 1.099 } }, [[1.102, 50]])
    const m = tradeMetrics(t, ctx)
    expect(m.resultR).toBeCloseTo(1, 9)
    expect(m.outcome).toBeNull()
    expect(m.countsInStats).toBe(false)
  })

  it('brak SL → R niedostępne, pipsy liczone', () => {
    const t = trade({ prices: { entry: 1.1 } }, [[1.102, 100]])
    const m = tradeMetrics(t, ctx)
    expect(m.resultR).toBeNull()
    expect(m.resultPips).toBeCloseTo(20, 9)
  })

  it('MAE/MFE w R', () => {
    const t = trade({ prices: { entry: 1.1, stopLoss: 1.099 }, maePips: 5, mfePips: 25 }, [[1.102, 100]])
    const m = tradeMetrics(t, ctx)
    expect(m.maeR).toBeCloseTo(0.5, 9)
    expect(m.mfeR).toBeCloseTo(2.5, 9)
  })

  it('riskReward: zerowe ryzyko → null', () => {
    expect(riskReward(1.1, 1.1, 1.2)).toBeNull()
  })
})

describe('missed trades', () => {
  const base = { status: 'missed' as const, prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.103, takeProfit2: 1.105 } }
  it('TP1 → R:R do TP1, poza statystykami', () => {
    const t = trade({ ...base, missed: { reasonId: null, hypotheticalOutcome: 'tp1' } }, [])
    const m = tradeMetrics(t, ctx)
    expect(m.resultR).toBeCloseTo(3, 9)
    expect(m.countsInStats).toBe(false)
  })
  it('SL → -1R', () => {
    const t = trade({ ...base, missed: { reasonId: null, hypotheticalOutcome: 'sl' } }, [])
    expect(tradeMetrics(t, ctx).resultR).toBe(-1)
  })
})

describe('break-even', () => {
  it('|R| ≤ 0.1 to BE', () => {
    expect(classifyOutcome(0.1, 0.1)).toBe('breakeven')
    expect(classifyOutcome(-0.1, 0.1)).toBe('breakeven')
    expect(classifyOutcome(0.11, 0.1)).toBe('win')
    expect(classifyOutcome(-0.11, 0.1)).toBe('loss')
  })
})

describe('killzone w transakcji', () => {
  it('automatyczne wykrycie i nadpisanie ręczne', () => {
    const t = trade({ prices: {} }, [])
    expect(tradeMetrics(t, ctx).killzoneNames.sort()).toEqual(['London', 'SB London'])
    expect(tradeMetrics({ ...t, killzoneOverride: 'none' }, ctx).killzoneNames).toEqual([])
    const ny = ctx.killzones.find((k) => k.name === 'New York')!
    expect(tradeMetrics({ ...t, killzoneOverride: ny.id }, ctx).killzoneNames).toEqual(['New York'])
  })
})

describe('kwoty w walucie konta', () => {
  // EURUSD long, 1R win: entry 1.0850, SL 1.0835, exit 1.0865.
  const win = (over: Partial<Trade> = {}) => ({ ...trade({ prices: { entry: 1.085, stopLoss: 1.0835 } }, [[1.0865, 100]]), status: 'closed' as const, riskAmount: 50, ...over })
  const withAmounts = (defaultCurrency: string, rates: Record<string, number>): MetricsContext => ({
    ...ctx,
    amounts: { accountCurrency: 'PLN', defaultCurrency, rate: (from) => (rates[from] != null ? { rate: rates[from]!, tableDate: null } : null) }
  })

  it('kwota w walucie konta bez przeliczenia', () => {
    const m = tradeMetrics(win({ amountCurrency: 'PLN' }), withAmounts('USD', { USD: 3.8881 }))
    expect(m.pnlAmount).toBeCloseTo(50, 9)
    expect(m.pnlAmountOwn).toBeCloseTo(50, 9)
    expect(m.amountCurrency).toBe('PLN')
  })

  it('kwota w innej walucie (wpisana przed zmianą waluty konta) przeliczona kursem', () => {
    const typed = tradeMetrics(win({ amountCurrency: 'USD' }), withAmounts('PLN', { USD: 3.8881 }))
    expect(typed.pnlAmountOwn).toBeCloseTo(50, 9)
    expect(typed.pnlAmount).toBeCloseTo(194.405, 9)
    // Without its own currency: the remembered first account currency.
    const legacy = tradeMetrics(win(), withAmounts('USD', { USD: 3.8881 }))
    expect(legacy.amountCurrency).toBe('USD')
    expect(legacy.pnlAmount).toBeCloseTo(194.405, 9)
    // No rate: unknown in the account currency (not shown as if it were PLN).
    expect(tradeMetrics(win({ amountCurrency: 'GBP' }), withAmounts('USD', {})).pnlAmount).toBeNull()
    // A trade without amounts has no amount currency.
    expect(tradeMetrics(win({ riskAmount: null }), withAmounts('USD', {})).amountCurrency).toBeNull()
    // Without the context nothing is converted (old callers).
    expect(tradeMetrics(win({ amountCurrency: 'USD' }), ctx).pnlAmount).toBeCloseTo(50, 9)
  })
})

