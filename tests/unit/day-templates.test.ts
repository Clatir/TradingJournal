import { describe, expect, it } from 'vitest'
import { createDayPlan, createDefaultJournal } from '@shared/defaults'
import { applyTemplate, newDayPlan, templateFromPlan } from '@shared/dayTemplates'
import type { DayPlan } from '@shared/schema'

function plan(): DayPlan {
  const p = createDayPlan('2026-10-05', ['EURUSD', 'GBPUSD'], ['DXY'])
  return {
    ...p,
    notes: 'Najpierw HTF',
    pairs: p.pairs.map((x) =>
      x.pair === 'EURUSD'
        ? {
            ...x,
            bias: { ...x.bias, D: { direction: 'bullish', reason: 'MSS' } },
            drawOnLiquidity: 'PDH',
            keyLevels: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', price: 1.0874, label: 'PDH' }],
            scenarioPrimary: 'sweep Asia low → long'
          }
        : x
    )
  }
}

describe('szablony planu dnia', () => {
  it('z planu: pary z DOL, scenariuszami i etykietami poziomów (bez cen i biasu), intermarket, notatki', () => {
    const t = templateFromPlan(plan(), '  London + NY ')
    expect(t.name).toBe('London + NY')
    expect(t.pairs).toEqual([
      { pair: 'EURUSD', drawOnLiquidity: 'PDH', levelLabels: ['PDH'], scenarioPrimary: 'sweep Asia low → long', scenarioAlternative: '' },
      { pair: 'GBPUSD', drawOnLiquidity: '', levelLabels: [], scenarioPrimary: '', scenarioAlternative: '' }
    ])
    expect(t.intermarket).toEqual(['DXY'])
    expect(t.notes).toBe('Najpierw HTF')
  })

  it('wstawienie uzupełnia tylko puste pola; pary spoza szablonu zostają', () => {
    const t = templateFromPlan(plan(), 'A')
    const other = { ...createDayPlan('2026-10-06', ['USDCHF', 'EURUSD'], ['EURX']), notes: '' }
    const filled = { ...other, pairs: other.pairs.map((p) => (p.pair === 'EURUSD' ? { ...p, drawOnLiquidity: 'PDL' } : p)) }
    const out = applyTemplate(filled, t)
    expect(out.pairs.map((p) => p.pair)).toEqual(['EURUSD', 'GBPUSD', 'USDCHF'])
    const eur = out.pairs[0]!
    expect(eur.drawOnLiquidity).toBe('PDL') // already written: kept
    expect(eur.scenarioPrimary).toBe('sweep Asia low → long')
    expect(eur.keyLevels.map((l) => [l.label, l.price])).toEqual([['PDH', null]])
    expect(eur.bias.D.direction).toBeNull()
    expect(out.intermarket.map((i) => i.instrument)).toEqual(['EURX', 'DXY'])
    expect(out.notes).toBe('Najpierw HTF')
    // Inserting twice adds no second level with the same label.
    expect(applyTemplate(out, t).pairs[0]!.keyLevels).toHaveLength(1)
  })

  it('nowy plan: z szablonu domyślnego, inaczej z podanych par', () => {
    const s = createDefaultJournal().settings
    expect(newDayPlan('2026-10-07', s, ['AUDUSD']).pairs.map((p) => p.pair)).toEqual(['AUDUSD'])
    expect(newDayPlan('2026-10-07', s, []).pairs.map((p) => p.pair)).toEqual(['EURUSD'])
    const t = { ...templateFromPlan(plan(), 'A'), isDefault: true }
    const fromDefault = newDayPlan('2026-10-07', { ...s, dayTemplates: [t] }, ['AUDUSD'])
    expect(fromDefault.date).toBe('2026-10-07')
    expect(fromDefault.pairs.map((p) => [p.pair, p.drawOnLiquidity])).toEqual([
      ['EURUSD', 'PDH'],
      ['GBPUSD', '']
    ])
    expect(fromDefault.intermarket.map((i) => i.instrument)).toEqual([...s.contextInstruments])
  })
})
