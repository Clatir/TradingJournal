import { describe, expect, it } from 'vitest'
import { migrateRaw, SchemaTooNewError } from '@shared/migrations'
import { parseRecordText, serializeRecord } from '@shared/records'
import { createDefaultJournal, createTrade } from '@shared/defaults'
import { SCHEMA_VERSION } from '@shared/schema'

const legacyTrade = {
  id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5',
  pair: 'EURUSD',
  direction: 'buy',
  entryTime: '2026-03-16T07:30:00.000Z',
  exitTime: '2026-03-16T09:10:00.000Z',
  entry: 1.085,
  stopLoss: 1.0835,
  takeProfit: 1.088,
  exitPrice: 1.088,
  notes: 'stary format'
}

describe('migracje schematu', () => {
  it('v0 (płaski format) → bieżący', () => {
    const r = parseRecordText('trades', JSON.stringify(legacyTrade))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.migrated).toBe(true)
    expect(r.fromVersion).toBe(0)
    expect(r.value.schemaVersion).toBe(SCHEMA_VERSION)
    expect(r.value.direction).toBe('long')
    expect(r.value.status).toBe('closed')
    expect(r.value.prices).toEqual({ entry: 1.085, stopLoss: 1.0835, takeProfit1: 1.088, takeProfit2: null })
    expect(r.value.exits).toHaveLength(1)
    expect(r.value.exits[0]).toMatchObject({ price: 1.088, percent: 100, time: '2026-03-16T09:10:00.000Z' })
    expect(r.value.notes).toBe('stary format')
    expect('entry' in r.value).toBe(false)
  })

  it('nowszy format → błąd z numerem wersji', () => {
    expect(() => migrateRaw('trades', { ...legacyTrade, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(SchemaTooNewError)
    const r = parseRecordText('trades', JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.tooNewVersion).toBe(SCHEMA_VERSION + 1)
  })

  it('bieżący format nie jest migrowany; nieznane pola są zachowane', () => {
    const t = createTrade({ pair: 'EURUSD', direction: 'short', entryTime: '2026-03-16T07:30:00.000Z' })
    const text = serializeRecord('trades', { ...t, futureField: { a: 1 } } as typeof t)
    const r = parseRecordText('trades', text)
    expect(r.ok).toBe(true)
    expect(r.ok && r.migrated).toBe(false)
    expect(r.ok && (r.value as Record<string, unknown>).futureField).toEqual({ a: 1 })
  })

  it('blok computed jest zapisywany, ale ignorowany przy odczycie', () => {
    const j = createDefaultJournal()
    const t = createTrade({
      pair: 'EURUSD',
      direction: 'long',
      entryTime: '2026-03-16T07:30:00.000Z',
      prices: { entry: 1.1, stopLoss: 1.099, takeProfit1: 1.102, takeProfit2: null }
    })
    const text = serializeRecord('trades', t, j.settings)
    const json = JSON.parse(text)
    expect(json.computed.riskPips).toBe(10)
    expect(json.computed.killzones).toEqual(['London', 'SB London'])
    expect(json.computed.entryNy).toBe('2026-03-16 03:30')
    const r = parseRecordText('trades', text)
    expect(r.ok).toBe(true)
    expect(r.ok && 'computed' in r.value).toBe(false)
  })

  it('uszkodzony JSON i zła struktura → czytelny błąd, bez wyjątku', () => {
    const bad = parseRecordText('trades', '{"id": "x", ')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/Uszkodzony JSON/)
    const wrong = parseRecordText('trades', JSON.stringify({ schemaVersion: SCHEMA_VERSION, id: 'abc' }))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error).toMatch(/Niepoprawna struktura/)
  })

  it('BOM na początku pliku jest akceptowany', () => {
    const t = createTrade({ pair: 'EURUSD', direction: 'long', entryTime: '2026-03-16T07:30:00.000Z' })
    expect(parseRecordText('trades', `\ufeff${serializeRecord('trades', t)}`).ok).toBe(true)
  })
})
