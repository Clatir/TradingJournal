import { describe, expect, it } from 'vitest'
import { createDefaultJournal } from '@shared/defaults'
import { newId } from '@shared/ids'
import { metricsContext, tradeMetrics } from '@shared/calc/trade'
import { validateTrade } from '@shared/calc/validator'
import {
  DEFAULT_COLUMNS,
  EMPTY_FILTER,
  advancedCount,
  customValueText,
  filterOf,
  filterRows,
  gridTemplate,
  moveColumn,
  resolveColumns,
  sameFilter,
  toggleColumn,
  withCustomValue
} from '@shared/journalView'
import { mergeJournal } from '../../src/main/datastore/transfer'
import { customFieldSchema, journalSchema, type CustomField, type JournalFile, type Trade } from '@shared/schema'
import { closedTradeAt } from './helpers/trades'

function journalWithFields(): { journal: JournalFile; grade: CustomField; conf: CustomField; note: CustomField; a1: CustomField } {
  const base = createDefaultJournal()
  const grade = customFieldSchema.parse({ id: newId(), name: 'Ocena setupu', type: 'select', options: [{ id: newId(), name: 'A+' }, { id: newId(), name: 'B' }] })
  const conf = customFieldSchema.parse({ id: newId(), name: 'Konfluencje', type: 'number' })
  const note = customFieldSchema.parse({ id: newId(), name: 'Kontekst', type: 'text' })
  const a1 = customFieldSchema.parse({ id: newId(), name: 'Wg planu', type: 'check' })
  const journal = journalSchema.parse({ ...base, settings: { ...base.settings, customFields: [grade, conf, note, a1] } })
  return { journal, grade, conf, note, a1 }
}

describe('własne pola transakcji', () => {
  it('wartości wg typu: normalizacja, czyszczenie, tekst', () => {
    const { grade, conf, note, a1 } = journalWithFields()
    let t = closedTradeAt('2026-09-01T12:00:00.000Z', 1)
    t = withCustomValue(t, grade, grade.options[0]!.id)
    t = withCustomValue(t, conf, 3)
    t = withCustomValue(t, note, '  ')
    t = withCustomValue(t, a1, true)
    expect(t.custom).toEqual({ [grade.id]: grade.options[0]!.id, [conf.id]: 3, [a1.id]: true })
    expect(withCustomValue(t, grade, 'nie-ma-takiej').custom[grade.id]).toBeUndefined()
    expect(withCustomValue(t, conf, Number.NaN).custom[conf.id]).toBeUndefined()
    expect([customValueText(grade, t.custom[grade.id]), customValueText(a1, false), customValueText(conf, 3), customValueText(note, undefined)]).toEqual(['A+', 'nie', '3', ''])
  })
})

describe('filtry dziennika', () => {
  const { journal, grade, conf, note, a1 } = journalWithFields()
  const ctx = metricsContext(journal.settings)
  const row = (t: Trade) => {
    const m = tradeMetrics(t, ctx)
    return { trade: t, m, v: validateTrade(t, m, journal.settings, null) }
  }
  const model = journal.dictionaries.entryModels[0]!.id
  const mistake = journal.dictionaries.mistakeTags[0]!.id
  const t1 = withCustomValue(withCustomValue(closedTradeAt('2026-09-01T12:00:00.000Z', 2, { entryModelId: model, notes: 'ładny sweep' }), grade, grade.options[0]!.id), conf, 4)
  const t2 = withCustomValue(closedTradeAt('2026-09-08T12:00:00.000Z', -1, { pair: 'GBPUSD' }), a1, true)
  const t3 = withCustomValue(
    closedTradeAt('2026-09-15T12:00:00.000Z', 0, { psychology: { ...closedTradeAt('2026-09-15T12:00:00.000Z', 0).psychology, mistakeTagIds: [mistake] } }),
    note,
    'Po NFP'
  )
  const t4 = closedTradeAt('2026-09-16T12:00:00.000Z', 1, { status: 'missed', exits: [] })
  const rows = [t1, t2, t3, t4].map(row)
  const ids = (f: Partial<typeof EMPTY_FILTER>) => filterRows(rows, { ...EMPTY_FILTER, ...f }, journal).map((r) => r.trade.id)

  it('podstawowe i zaawansowane warunki', () => {
    expect(ids({})).toHaveLength(4)
    expect(ids({ pair: 'GBPUSD' })).toEqual([t2.id])
    expect(ids({ status: 'missed' })).toEqual([t4.id])
    expect(ids({ from: '2026-09-08', to: '2026-09-15' })).toEqual([t2.id, t3.id])
    expect(ids({ outcome: 'win' })).toEqual([t1.id])
    expect(ids({ outcome: 'breakeven' })).toEqual([t3.id])
    expect(ids({ mistakes: 'with' })).toEqual([t3.id])
    expect(ids({ mistakes: 'without' })).toEqual([t1.id, t2.id, t4.id])
    expect(ids({ modelId: model })).toEqual([t1.id])
    expect(ids({ query: 'sweep' })).toEqual([t1.id])
    // Search covers custom values (option names, text).
    expect(ids({ query: 'a+' })).toEqual([t1.id])
    expect(ids({ query: 'nfp' })).toEqual([t3.id])
  })

  it('warunki na własnych polach', () => {
    const c = (x: object) => ({ fieldId: '', text: null, optionId: null, min: null, max: null, checked: null, ...x })
    expect(ids({ custom: [c({ fieldId: grade.id, optionId: grade.options[0]!.id })] })).toEqual([t1.id])
    expect(ids({ custom: [c({ fieldId: conf.id, min: 3 })] })).toEqual([t1.id])
    expect(ids({ custom: [c({ fieldId: conf.id, max: 3 })] })).toEqual([])
    expect(ids({ custom: [c({ fieldId: a1.id, checked: true })] })).toEqual([t2.id])
    expect(ids({ custom: [c({ fieldId: a1.id, checked: false })] })).toEqual([t1.id, t3.id, t4.id])
    expect(ids({ custom: [c({ fieldId: note.id, text: 'nfp' })] })).toEqual([t3.id])
    // An empty condition does not filter and is not counted.
    expect(ids({ custom: [c({ fieldId: note.id })] })).toHaveLength(4)
    expect(advancedCount({ ...EMPTY_FILTER, outcome: 'win', from: '2026-01-01', custom: [c({ fieldId: note.id }), c({ fieldId: a1.id, checked: true })] })).toBe(3)
  })

  it('zapisany filtr = ten sam zestaw warunków (bez nazwy i pustych warunków)', () => {
    const saved = { ...EMPTY_FILTER, id: newId(), name: 'A+ w NY', pair: 'EURUSD', custom: [] }
    expect(sameFilter(saved, { ...EMPTY_FILTER, pair: 'EURUSD' })).toBe(true)
    expect(sameFilter(saved, { ...EMPTY_FILTER, pair: 'EURUSD', custom: [{ fieldId: a1.id, text: null, optionId: null, min: null, max: null, checked: null }] })).toBe(true)
    expect(sameFilter(saved, { ...EMPTY_FILTER, pair: 'GBPUSD' })).toBe(false)
    expect(filterOf(saved)).not.toHaveProperty('name')
  })
})

describe('kolumny dziennika', () => {
  it('domyślny zestaw, własne pola, kolejność, ukrywanie', () => {
    const { journal, grade, conf } = journalWithFields()
    const fields = journal.settings.customFields
    expect(resolveColumns(null, fields).map((c) => c.id)).toEqual(DEFAULT_COLUMNS)
    let cols = toggleColumn(null, `cf:${grade.id}`)
    cols = toggleColumn(cols, 'weekday')
    cols = moveColumn(cols, `cf:${grade.id}`, -1)
    const resolved = resolveColumns(cols, fields)
    expect(resolved.at(-2)?.label).toBe('Ocena setupu')
    expect(resolved.map((c) => c.id)).not.toContain('weekday')
    // Archived fields and unknown ids are skipped; nothing left = the default set.
    expect(resolveColumns([`cf:${grade.id}`, 'nie-ma'], fields.map((f) => (f.id === grade.id ? { ...f, archived: true } : f))).map((c) => c.id)).toEqual(DEFAULT_COLUMNS)
    expect(gridTemplate(resolveColumns(['date', `cf:${conf.id}`], fields))).toBe('82px 56px 24px')
    expect(moveColumn(['date', 'r'], 'date', -1)).toEqual(['date', 'r'])
  })
})

describe('import (scal): własne pola i powody odrzucenia', () => {
  it('brakujące pola i opcje dołączane po id', () => {
    const { journal, grade } = journalWithFields()
    const extraOption = { id: newId(), name: 'C', archived: false }
    const otherField = customFieldSchema.parse({ id: newId(), name: 'Inne', type: 'text' })
    const incoming = journalSchema.parse({
      ...journal,
      dictionaries: { ...journal.dictionaries, rejectReasons: [...journal.dictionaries.rejectReasons, { id: newId(), name: 'Piątek po 12:00', archived: false }] },
      settings: { ...journal.settings, customFields: [{ ...grade, options: [...grade.options, extraOption] }, otherField] }
    })
    const current = journalSchema.parse({ ...journal, settings: { ...journal.settings, customFields: [grade] } })
    const merged = mergeJournal(current, incoming)
    expect(merged.settings.customFields.map((f) => f.name)).toEqual(['Ocena setupu', 'Inne'])
    expect(merged.settings.customFields[0]!.options.map((o) => o.name)).toEqual(['A+', 'B', 'C'])
    expect(merged.dictionaries.rejectReasons.at(-1)?.name).toBe('Piątek po 12:00')
  })
})

describe('własne pola w analityce i CSV', () => {
  it('rozbicie wyniku wg listy, tak/nie i liczby; tekst nie jest grupowany', async () => {
    const { customFieldBreakdowns } = await import('@shared/calc/analytics')
    const { tradesToCsv } = await import('@shared/export/csv')
    const { journal, grade, conf, note, a1 } = journalWithFields()
    const ctx = metricsContext(journal.settings)
    const trades = [
      withCustomValue(withCustomValue(closedTradeAt('2026-09-01T12:00:00.000Z', 2), grade, grade.options[0]!.id), conf, 2.5),
      withCustomValue(withCustomValue(closedTradeAt('2026-09-02T12:00:00.000Z', -1), grade, grade.options[1]!.id), a1, true),
      withCustomValue(withCustomValue(closedTradeAt('2026-09-03T12:00:00.000Z', 3), grade, grade.options[0]!.id), note, 'tekst; z "cudzysłowem"'),
      closedTradeAt('2026-09-04T12:00:00.000Z', -1)
    ]
    const rows = trades.map((t) => {
      const m = tradeMetrics(t, ctx)
      return { trade: t, m, v: validateTrade(t, m, journal.settings, null) }
    })
    const b = customFieldBreakdowns(rows, journal)
    expect(b.map((x) => x.field.name)).toEqual(['Ocena setupu', 'Konfluencje', 'Wg planu'])
    const g = b[0]!.groups.map((x) => [x.label, x.count, Number(x.totalR.toFixed(6))])
    expect(g).toEqual([
      ['A+', 2, 5],
      ['B', 1, -1],
      ['— brak —', 1, -1]
    ])
    expect(b[2]!.groups.map((x) => [x.label, x.count])).toEqual([
      ['Tak', 1],
      ['— brak —', 3]
    ])
    const csv = tradesToCsv(trades, journal).split('\r\n')
    expect(csv[0]!.endsWith(';Ocena setupu;Konfluencje;Kontekst;Wg planu')).toBe(true)
    expect(csv[1]!.endsWith(';A+;2,5;;')).toBe(true)
    expect(csv[2]!.endsWith(';B;;;tak')).toBe(true)
    expect(csv[3]).toContain(';"tekst; z ""cudzysłowem""";')
  })
})
