import { describe, expect, it } from 'vitest'
import { chooser, deepEqual, diffRecords, fieldLabel, formatValue, merge3, pathKey } from '@shared/merge'

const base = {
  id: 'T',
  updatedAt: '2026-10-05T08:00:00.000Z',
  updatedBy: 'PC-A',
  notes: 'plan',
  lots: 0.5,
  prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: null as number | null },
  exits: [{ id: 'x1', price: 1.087, percent: 50 }],
  psychology: { mistakeTagIds: ['m1'] }
}

describe('różnice pól', () => {
  it('liście obiektów, listy po id, pola techniczne pominięte', () => {
    const after = {
      ...base,
      updatedAt: 'later',
      notes: 'plan 2',
      prices: { ...base.prices, stopLoss: 1.083 },
      exits: [{ id: 'x1', price: 1.088, percent: 50 }, { id: 'x2', price: 1.09, percent: 50 }],
      psychology: { mistakeTagIds: ['m1', 'm2'] }
    }
    expect(diffRecords(base, after).map((c) => [c.path.join('.'), c.before, c.after])).toEqual([
      ['notes', 'plan', 'plan 2'],
      ['prices.stopLoss', 1.0835, 1.083],
      ['exits.#x1.price', 1.087, 1.088],
      ['exits.#x2', undefined, { id: 'x2', price: 1.09, percent: 50 }],
      ['psychology.mistakeTagIds', ['m1'], ['m1', 'm2']]
    ])
    expect(diffRecords(base, structuredClone(base))).toEqual([])
    expect(deepEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
  })

  it('etykiety i wartości po polsku', () => {
    expect(fieldLabel(['prices', 'stopLoss'])).toBe('Stop loss')
    expect(fieldLabel(['exits', '#x1', 'price'])).toBe('Wyjście – cena')
    expect(fieldLabel(['broker', 'net'])).toBe('Dane brokera – net')
    expect(fieldLabel(['nieznane', 'pole'])).toBe('nieznane.pole')
    expect([formatValue(null), formatValue(undefined), formatValue([]), formatValue([1, 2]), formatValue(1.5), formatValue('a'.repeat(100), 10)]).toEqual([
      'puste',
      '—',
      'puste',
      '2 pozycje',
      '1.5',
      'aaaaaaaaa…'
    ])
  })
})

describe('scalanie trzech wersji', () => {
  it('zmiany w różnych polach łączą się bez pytania', () => {
    const mine = { ...base, notes: 'moja notatka', exits: [{ id: 'x1', price: 1.087, percent: 50 }, { id: 'x3', price: 1.089, percent: 50 }] }
    const theirs = { ...base, updatedAt: 'T2', updatedBy: 'PC-B', lots: 0.6, prices: { ...base.prices, takeProfit1: 1.09 } }
    const { merged, conflicts } = merge3(base, mine, theirs)
    expect(conflicts).toEqual([])
    expect(merged).toMatchObject({ notes: 'moja notatka', lots: 0.6, prices: { entry: 1.085, stopLoss: 1.0835, takeProfit1: 1.09 }, updatedAt: 'T2', updatedBy: 'PC-B' })
    expect(merged.exits.map((x) => x.id)).toEqual(['x1', 'x3'])
  })

  it('to samo pole zmienione po obu stronach: konflikt, wybór per pole', () => {
    const mine = { ...base, notes: 'A', lots: 0.7 }
    const theirs = { ...base, notes: 'B', lots: 0.7, prices: { ...base.prices, entry: 1.086 } }
    const r = merge3(base, mine, theirs)
    expect(r.conflicts.map((c) => [c.path.join('.'), c.mine, c.theirs])).toEqual([['notes', 'A', 'B']])
    expect(r.merged).toMatchObject({ notes: 'A', lots: 0.7, prices: { entry: 1.086 } })
    const r2 = merge3(base, mine, theirs, chooser({ [pathKey(['notes'])]: 'theirs' }))
    expect(r2.merged.notes).toBe('B')
    expect(merge3(base, mine, theirs, () => 'theirs').merged.notes).toBe('B')
  })

  it('listy po id: dodane po obu stronach zostają, usunięte bez zmian znikają, usunięte-zmienione to konflikt', () => {
    const b = { exits: [{ id: 'a', p: 1 }, { id: 'b', p: 2 }, { id: 'c', p: 3 }] }
    const mine = { exits: [{ id: 'a', p: 1 }, { id: 'b', p: 20 }, { id: 'm', p: 9 }] } // c removed, b changed, m added
    const theirs = { exits: [{ id: 'a', p: 10 }, { id: 'c', p: 3 }, { id: 't', p: 8 }] } // b removed, a changed, t added
    const r = merge3(b, mine, theirs)
    expect(r.conflicts.map((c) => c.path.join('.'))).toEqual(['exits.#b'])
    expect(r.merged.exits).toEqual([{ id: 'a', p: 10 }, { id: 't', p: 8 }, { id: 'b', p: 20 }, { id: 'm', p: 9 }])
    const takeTheirs = merge3(b, mine, theirs, () => 'theirs')
    expect(takeTheirs.merged.exits.map((x) => x.id)).toEqual(['a', 't', 'm'])
  })

  it('bez wersji bazowej każda różnica jest konfliktem; identyczne zmiany nie są', () => {
    const r = merge3(undefined, { a: 1, b: 2 }, { a: 1, b: 3 })
    expect(r.conflicts.map((c) => c.path.join('.'))).toEqual(['b'])
    expect(merge3(base, { ...base, notes: 'x' }, { ...base, notes: 'x' }).conflicts).toEqual([])
  })

  it('usunięcie klucza po jednej stronie bez zmian po drugiej', () => {
    const r = merge3({ a: 1, b: 2 }, { a: 1 }, { a: 5, b: 2 })
    expect(r.merged).toEqual({ a: 5 })
    expect(r.conflicts).toEqual([])
  })
})
