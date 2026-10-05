import { describe, expect, it } from 'vitest'
import { createDayPlan, createForecast, createTrade } from '@shared/defaults'
import { copyDayPlanTo, copyName, duplicateForecast, duplicateLibraryItem, duplicateTrade } from '@shared/duplicate'
import { newId } from '@shared/ids'
import { SCHEMA_VERSION, dayPlanSchema, forecastSchema, libraryItemSchema, tradeSchema, type ScreenRef } from '@shared/schema'

const NOW = '2026-10-02T10:00:00.000Z'

const screen = (): ScreenRef => ({
  id: newId(),
  path: 'screens/2026/03/01J_przed.webp',
  thumbPath: 'screens/2026/03/01J_przed.thumb.webp',
  phase: 'before',
  timeframe: 'H1',
  caption: '',
  width: 1920,
  height: 1080,
  bytes: 1000,
  createdAt: '2026-03-16T07:00:00.000Z',
  annotations: []
})

describe('duplikowanie wpisów', () => {
  it('transakcja: identyczna treść, nowe id i czasy, nowe id wyjść, wspólne pliki screenów', () => {
    const t = createTrade(
      {
        pair: 'EURUSD',
        direction: 'short',
        entryTime: '2026-03-16T07:30:00.000Z',
        prices: { entry: 1.085, stopLoss: 1.0865, takeProfit1: 1.082, takeProfit2: null },
        exits: [
          { id: newId(), time: '2026-03-16T08:10:00.000Z', price: 1.082, percent: 50, note: 'TP1' },
          { id: newId(), time: null, price: 1.0835, percent: 50, note: '' }
        ],
        notes: 'Sweep PDH → MSS',
        screens: [screen()]
      },
      '2026-03-16T09:00:00.000Z'
    )
    const copy = duplicateTrade(t, NOW)
    expect(tradeSchema.safeParse(copy).success).toBe(true)
    expect(copy.id).not.toBe(t.id)
    expect(copy.createdAt).toBe(NOW)
    expect(copy.updatedAt).toBe(NOW)
    expect(copy.schemaVersion).toBe(SCHEMA_VERSION)
    expect(copy.exits.map((x) => x.id)).not.toEqual(t.exits.map((x) => x.id))
    expect(copy.exits.map(({ id: _id, ...rest }) => rest)).toEqual(t.exits.map(({ id: _id, ...rest }) => rest))
    expect(copy.prices).toEqual(t.prices)
    expect(copy.notes).toBe(t.notes)
    expect(copy.screens).toEqual(t.screens)
    // Deep copy: editing the duplicate never touches the original.
    copy.exits[0]!.price = 1.0
    copy.screens[0]!.annotations.push({ id: newId(), type: 'text', x1: 0.1, y1: 0.1, x2: 0, y2: 0, text: 'x', color: '#fff' })
    expect(t.exits[0]!.price).toBe(1.082)
    expect(t.screens[0]!.annotations).toHaveLength(0)
  })

  it('przykład z biblioteki: tytuł oznaczony jako kopia', () => {
    const item = libraryItemSchema.parse({ schemaVersion: 1, id: newId(), createdAt: NOW, updatedAt: NOW, title: 'London sweep', screens: [screen()] })
    const copy = duplicateLibraryItem(item, NOW)
    expect(copy.id).not.toBe(item.id)
    expect(copy.title).toBe('London sweep (kopia)')
    expect(copy.screens[0]?.path).toBe(item.screens[0]?.path)
    expect(duplicateLibraryItem({ ...item, title: ' ' }, NOW).title).toBe('Kopia przykładu')
  })

  it('plan dnia na inny dzień: analiza tak, newsy / podsumowanie / screeny nie', () => {
    const d = createDayPlan('2026-03-16', ['EURUSD', 'GBPUSD'], ['DXY'], NOW)
    d.pairs[0]!.bias.D = { direction: 'bullish', reason: 'nad PDH' }
    d.pairs[0]!.keyLevels = [{ id: newId(), price: 1.09, label: 'PDH' }]
    d.pairs[0]!.screens = [screen()]
    d.intermarket[0]!.relation = 'confirms'
    d.news = [{ id: newId(), time: '2026-03-16T12:30:00.000Z', currency: 'USD', title: 'CPI', impact: 'high' }]
    d.review = { whatHappened: 'Zrealizowany scenariusz', vsPlan: 'matched', notes: 'Wnioski' }
    d.screens = [screen()]
    d.notes = 'Tydzień pod FOMC'

    const copy = copyDayPlanTo(d, '2026-03-17', NOW)
    expect(dayPlanSchema.safeParse(copy).success).toBe(true)
    expect(copy.id).not.toBe(d.id)
    expect(copy.date).toBe('2026-03-17')
    expect(copy.pairs.map((p) => p.pair)).toEqual(['EURUSD', 'GBPUSD'])
    expect(copy.pairs[0]!.bias.D).toEqual({ direction: 'bullish', reason: 'nad PDH' })
    expect(copy.pairs[0]!.keyLevels[0]).toMatchObject({ price: 1.09, label: 'PDH' })
    expect(copy.pairs[0]!.keyLevels[0]!.id).not.toBe(d.pairs[0]!.keyLevels[0]!.id)
    expect(copy.pairs[0]!.screens).toEqual([])
    expect(copy.intermarket[0]!.relation).toBe('confirms')
    expect(copy.notes).toBe('Tydzień pod FOMC')
    expect(copy.news).toEqual([])
    expect(copy.review).toMatchObject({ whatHappened: '', vsPlan: null, notes: '' })
    expect(copy.screens).toEqual([])
    expect(d.news).toHaveLength(1)
  })

  it('scenariusz prognozy: nowe id i czasy, nazwa „(kopia)”, te same losowania i ustawienia', () => {
    const f = createForecast({ accountCurrency: 'PLN', accountBalance: 20000 }, [], '2026-03-16T07:00:00.000Z')
    f.goals = [{ id: newId(), name: 'Cel 1', month: 6, amount: 2000, enabled: true, flexible: false }]
    f.deposits = { '3': 5000 }
    f.notes = 'wariant ostrożny'
    const copy = duplicateForecast(f, ['Scenariusz 1'], NOW)
    expect(forecastSchema.safeParse(copy).success).toBe(true)
    expect(copy.id).not.toBe(f.id)
    expect(copy).toMatchObject({ createdAt: NOW, updatedAt: NOW, schemaVersion: SCHEMA_VERSION, name: 'Scenariusz 1 (kopia)' })
    expect(copy.draws).toEqual(f.draws)
    expect(copy.draws.rate).not.toBe(f.draws.rate)
    expect(copy.deposits).toEqual({ '3': 5000 })
    expect(copy.notes).toBe('wariant ostrożny')
    expect(copy.goals[0]).toMatchObject({ name: 'Cel 1', month: 6, amount: 2000 })
    expect(copy.goals[0]!.id).not.toBe(f.goals[0]!.id)
    expect(f.name).toBe('Scenariusz 1')
  })

  it('nazwa kopii: „(kopia)”, potem „(kopia 2)”, „(kopia 3)”; zmieszczona w 60 znakach', () => {
    expect(copyName('Plan', [])).toBe('Plan (kopia)')
    expect(copyName('Plan', ['Plan (kopia)'])).toBe('Plan (kopia 2)')
    expect(copyName('Plan', ['Plan (kopia)', 'Plan (kopia 2)'])).toBe('Plan (kopia 3)')
    expect(copyName('Plan', ['plan (KOPIA)'])).toBe('Plan (kopia 2)') // same check as the name field: case-insensitive
    const long = 'x'.repeat(60)
    expect(copyName(long, [])).toBe(`${'x'.repeat(52)} (kopia)`)
    expect(copyName(long, [`${'x'.repeat(52)} (kopia)`])).toHaveLength(60)
  })
})
