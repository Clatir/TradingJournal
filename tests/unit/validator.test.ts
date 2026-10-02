import { describe, expect, it } from 'vitest'
import { createDayPlan, createDefaultJournal, createTrade } from '@shared/defaults'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { dailyLimitState, validateTrade } from '@shared/calc/validator'
import { newId } from '@shared/ids'
import type { DayPlan, Trade } from '@shared/schema'

const journal = createDefaultJournal()
const settings = journal.settings

function trade(over: Partial<Trade> = {}): Trade {
  return createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime: '2026-03-16T07:30:00.000Z', // 03:30 NY, London + SB
    prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: 1.088, takeProfit2: null },
    stopBeyondLiquidity: 'yes',
    ...over
  })
}

function plan(bias: 'bullish' | 'bearish' | 'neutral' | null, news = false): DayPlan {
  const d = createDayPlan('2026-03-16', ['EURUSD'], settings.contextInstruments)
  d.pairs[0]!.bias.D.direction = bias
  if (news) d.news.push({ id: newId(), time: '2026-03-16T12:30:00.000Z', currency: 'USD', title: 'CPI', impact: 'high' })
  return d
}

const run = (t: Trade, day: DayPlan | null = plan('bullish')) => validateTrade(t, tradeMetrics(t, metricsContext(settings)), settings, day)

describe('walidator zasad', () => {
  it('transakcja zgodna ze wszystkimi zasadami', () => {
    const v = run(trade())
    expect(v.rules.map((r) => [r.id, r.status])).toEqual([
      ['maxStopPips', 'pass'],
      ['minRiskReward', 'pass'],
      ['killzone', 'pass'],
      ['htfBias', 'pass'],
      ['stopBeyondLiquidity', 'pass'],
      ['newsDay', 'pass']
    ])
    expect(v.score).toBe(1)
    expect(v.compliant).toBe(true)
  })

  it('SL > 20 pipsów, R:R < 2, poza killzone, przeciw biasowi, SL w płynności', () => {
    const t = trade({
      entryTime: '2026-03-16T16:30:00.000Z', // 12:30 NY – poza killzone
      prices: { entry: 1.085, stopLoss: 1.0825, takeProfit1: 1.088, takeProfit2: null },
      stopBeyondLiquidity: 'no',
      direction: 'long'
    })
    const v = run(t, plan('bearish'))
    expect(v.broken.map((b) => b.id)).toEqual(['maxStopPips', 'minRiskReward', 'killzone', 'htfBias', 'stopBeyondLiquidity'])
    expect(v.score).toBe(0)
    expect(v.compliant).toBe(false)
    expect(v.broken[0]?.detail).toBe('SL 25.0 p > 20 p')
  })

  it('wartości graniczne: SL dokładnie 20 p i R:R dokładnie 2 przechodzą', () => {
    const v = run(trade({ prices: { entry: 1.1, stopLoss: 1.098, takeProfit1: 1.104, takeProfit2: null } }))
    expect(v.rules.find((r) => r.id === 'maxStopPips')?.status).toBe('pass')
    expect(v.rules.find((r) => r.id === 'minRiskReward')?.status).toBe('pass')
  })

  it('brak danych → n/d i nie obniża oceny', () => {
    const v = run(trade({ prices: { entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null }, stopBeyondLiquidity: 'unknown' }), null)
    expect(v.rules.filter((r) => r.status === 'na').map((r) => r.id)).toEqual(['maxStopPips', 'minRiskReward', 'htfBias', 'stopBeyondLiquidity'])
    expect(v.applicable).toBe(1) // only killzone
    expect(v.score).toBe(1)
  })

  it('bias neutralny lub brak sekcji pary → n/d', () => {
    expect(run(trade(), plan('neutral')).rules.find((r) => r.id === 'htfBias')?.status).toBe('na')
    expect(run(trade({ pair: 'GBPUSD' }), plan('bullish')).rules.find((r) => r.id === 'htfBias')?.detail).toMatch(/bez sekcji GBPUSD/)
  })

  it('dzień z newsem jest tylko informacją – nie zmienia oceny', () => {
    const v = run(trade(), plan('bullish', true))
    const news = v.rules.find((r) => r.id === 'newsDay')!
    expect(news.status).toBe('info')
    expect(news.affectsScore).toBe(false)
    expect(news.detail).toBe('08:30 USD CPI')
    expect(v.score).toBe(1)
  })

  it('wyłączona zasada i zmieniony próg', () => {
    const custom = structuredClone(settings)
    custom.rules.maxStopPips.value = 10
    custom.rules.requireKillzone.enabled = false
    const t = trade({ entryTime: '2026-03-16T16:30:00.000Z' })
    const v = validateTrade(t, tradeMetrics(t, metricsContext(custom)), custom, plan('bullish'))
    expect(v.rules.some((r) => r.id === 'killzone')).toBe(false)
    expect(v.rules.find((r) => r.id === 'maxStopPips')?.status).toBe('fail')
  })

  it('bias z innego interwału (H4)', () => {
    const custom = structuredClone(settings)
    custom.rules.htfBias.timeframe = 'H4'
    const d = plan('bullish')
    d.pairs[0]!.bias.H4.direction = 'bearish'
    const t = trade()
    expect(validateTrade(t, tradeMetrics(t, metricsContext(custom)), custom, d).rules.find((r) => r.id === 'htfBias')?.status).toBe('fail')
  })
})

describe('limity dzienne', () => {
  const e = (resultR: number | null, status: Trade['status'] = 'closed', tradingDate = '2026-03-16') => ({ resultR, status, tradingDate })
  it('limit straty w R i liczby transakcji', () => {
    const s = dailyLimitState('2026-03-16', [e(-1), e(-1), e(2, 'closed', '2026-03-15'), e(null, 'missed')], settings)
    expect(s.totalR).toBe(-2)
    expect(s.trades).toBe(2)
    expect(s.lossLimitHit).toBe(true)
    expect(s.maxTradesHit).toBe(false)
    const t = dailyLimitState('2026-03-16', [e(1), e(-1), e(null, 'open')], settings)
    expect(t.maxTradesHit).toBe(true)
    expect(t.lossLimitHit).toBe(false)
  })
})
