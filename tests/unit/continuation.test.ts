import { describe, expect, it } from 'vitest'
import { createDefaultJournal, createTrade } from '@shared/defaults'
import { continuationCandidate, continuationCheck, continuationFields, continuationsOf } from '@shared/calc/continuation'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { dailyLimitState, validateTrade } from '@shared/calc/validator'
import { goalState } from '@shared/calc/goals'
import { breakdowns } from '@shared/calc/analytics'
import { tradeComputed } from '@shared/records'
import { tradesToCsv } from '@shared/export/csv'
import { tradeToMarkdown } from '@shared/export/markdown'
import { duplicateTrade } from '@shared/duplicate'
import type { Trade } from '@shared/schema'

const journal = createDefaultJournal()
const settings = journal.settings
const kzs = settings.killzones

// 2026-10-06 (EDT): London entry 03:15 NY (09:15 Warsaw), closed 14:00 NY (20:00 Warsaw).
function trade(entryTime: string, exitTime: string | null, over: Partial<Trade> = {}): Trade {
  return createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime,
    prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.103, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: exitTime, price: 1.101, percent: 100, note: '' }],
    ...over
  })
}
const first = trade('2026-10-06T07:15:00.000Z', '2026-10-06T18:00:00.000Z')
const lookupOf = (list: Trade[]) => (id: string) => list.find((t) => t.id === id)
const killzoneRule = (t: Trade, list: Trade[]) => {
  const m = tradeMetrics(t, metricsContext(settings))
  return validateTrade(t, m, settings, null, continuationCheck(t, lookupOf(list), kzs)).rules.find((r) => r.id === 'killzone')!
}

describe('kontynuacja (ponowne otwarcie zamkniętej pozycji)', () => {
  it('re-open 21:00 Warszawa tego samego dnia handlowego NY: killzone z pierwszego wejścia', () => {
    const again = trade('2026-10-06T19:00:00.000Z', '2026-10-06T20:00:00.000Z', { continuationOf: first.id })
    const c = continuationCheck(again, lookupOf([first]), kzs)
    expect(c).toMatchObject({ ok: true, parent: first, origin: first })
    expect(c?.ok && c.originKillzones).toContain('London')
    expect(killzoneRule(again, [first])).toMatchObject({ status: 'pass', detail: expect.stringContaining('kontynuacja wejścia z London') })
    // Without the link the same entry is outside killzone.
    expect(killzoneRule({ ...again, continuationOf: null }, [first])).toMatchObject({ status: 'fail', detail: '15:00 NY – poza killzone' })
  })

  it('granica: do północy NY (06:00 Warszawa) tak, później i następnego dnia nie; inna para, kierunek, brak pierwotnej', () => {
    const at = (iso: string, over: Partial<Trade> = {}) => continuationCheck(trade(iso, null, { continuationOf: first.id, ...over }), lookupOf([first]), kzs)
    expect(at('2026-10-07T03:59:00.000Z')!.ok).toBe(true) // 23:59 NY
    const late = at('2026-10-07T04:00:00.000Z')! // 00:00 NY next day
    expect(late).toMatchObject({ ok: false, reason: 'otwarta ponownie po dniu handlowym NY zamknięcia (2026-10-06)' })
    expect(at('2026-10-06T17:00:00.000Z')).toMatchObject({ ok: false, reason: 'wejście przed zamknięciem pierwotnej transakcji' })
    expect(at('2026-10-06T19:00:00.000Z', { pair: 'GBPUSD' })).toMatchObject({ ok: false, reason: 'inna para albo kierunek niż pierwotna transakcja' })
    expect(at('2026-10-06T19:00:00.000Z', { direction: 'short' })!.ok).toBe(false)
    expect(continuationCheck(trade('2026-10-06T19:00:00.000Z', null, { continuationOf: '01K6H3Z0W8Q4M2N5P7R9S1T3V9' }), lookupOf([first]), kzs)).toMatchObject({
      ok: false,
      reason: 'pierwotnej transakcji nie ma w dzienniku'
    })
    // An invalid link: checked as a new entry, the reason in the detail.
    const next = trade('2026-10-07T16:00:00.000Z', null, { continuationOf: first.id })
    expect(killzoneRule(next, [first])).toMatchObject({ status: 'fail', detail: expect.stringContaining('(nie kontynuacja: otwarta ponownie po dniu handlowym NY') })
  })

  it('łańcuch: druga kontynuacja bierze killzone z pierwszego wejścia; pierwsze poza KZ → nadal złamana', () => {
    const second = trade('2026-10-06T19:00:00.000Z', '2026-10-06T19:30:00.000Z', { continuationOf: first.id })
    const third = trade('2026-10-06T20:00:00.000Z', null, { continuationOf: second.id })
    const c = continuationCheck(third, lookupOf([first, second]), kzs)
    expect(c).toMatchObject({ ok: true, parent: second, origin: first, chain: [second, first] })
    const outside = trade('2026-10-06T16:00:00.000Z', '2026-10-06T18:00:00.000Z') // 12:00 NY
    const re = trade('2026-10-06T19:00:00.000Z', null, { continuationOf: outside.id })
    expect(killzoneRule(re, [outside])).toMatchObject({ status: 'fail', detail: 'kontynuacja – pierwsze wejście (12:00 NY) też poza killzone' })
  })

  it('podpowiedź: ta sama para i kierunek zamknięta wcześniej tego dnia NY; pola przejmowane; lista kontynuacji', () => {
    const reopen = trade('2026-10-06T19:00:00.000Z', null)
    const other = trade('2026-10-06T08:00:00.000Z', '2026-10-06T09:00:00.000Z', { pair: 'GBPUSD' })
    const earlier = trade('2026-10-06T07:00:00.000Z', '2026-10-06T12:00:00.000Z')
    expect(continuationCandidate(reopen, [first, other, earlier, reopen])).toBe(first) // the latest close
    expect(continuationCandidate({ ...reopen, entryTime: '2026-10-07T13:00:00.000Z' }, [first])).toBeNull()
    expect(continuationCandidate({ ...reopen, continuationOf: first.id }, [first])).toBeNull()
    expect(continuationFields(first)).toMatchObject({ pair: 'EURUSD', direction: 'long', continuationOf: first.id })
    const child = { ...reopen, continuationOf: first.id }
    expect(continuationsOf(first.id, [first, child, other])).toEqual([child])
    expect(duplicateTrade(child, '2026-10-06T20:00:00.000Z').continuationOf).toBeNull()
  })

  it('limit transakcji: kontynuacja nie jest kolejną transakcją (R się liczy); przy ponownym otwarciu limit liczby nie pyta', () => {
    const s = { ...settings, risk: { ...settings.risk, dailyMaxTrades: 2, dailyLossLimitR: null } }
    const e = (continuation: boolean) => ({ status: 'closed' as const, tradingDate: '2026-10-06', resultR: -0.5, riskPercent: 1, continuation })
    const d = dailyLimitState('2026-10-06', [e(false), e(true)], s)
    expect(d).toMatchObject({ trades: 1, maxTradesHit: false })
    expect(d.totalR).toBeCloseTo(-1, 9)
    expect(goalState('2026-10-06', [e(false), e(false)], s).alerts).toEqual(['Limit transakcji na dziś: 2 z 2.'])
    expect(goalState('2026-10-06', [e(false), e(false)], s, { reopening: true }).alerts).toEqual([])
  })

  it('analityka, plik (computed), CSV i markdown', () => {
    const again = trade('2026-10-06T19:00:00.000Z', '2026-10-06T20:00:00.000Z', { continuationOf: first.id })
    const rows = [first, again].map((t) => {
      const m = tradeMetrics(t, metricsContext(settings))
      return { trade: t, m, v: validateTrade(t, m, settings, null) }
    })
    expect(breakdowns(rows, journal).entry.map((g) => [g.label, g.count])).toEqual([
      ['Pierwsze wejście', 1],
      ['Ponowne otwarcie', 1]
    ])
    const computed = tradeComputed(again, { settings, trade: lookupOf([first]) })
    expect(computed.continuation).toContain('kontynuacja wejścia z London')
    expect(computed.brokenRules).toEqual([])
    expect(tradeComputed(again, { settings }).brokenRules).toEqual(['Wejście w killzone: 15:00 NY – poza killzone'])
    const csv = tradesToCsv([first, again], journal)
    expect(csv).not.toContain('poza killzone')
    expect(tradeToMarkdown(again, journal, null, lookupOf([first]))).toContain('(kontynuacja wejścia z London')
  })
})
