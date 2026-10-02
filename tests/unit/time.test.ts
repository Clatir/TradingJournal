import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { defaultKillzones } from '@shared/defaults'
import {
  formatClock,
  fromLocal,
  killzonesAt,
  nyWarsawGapHours,
  primaryKillzone,
  tradingDateNy
} from '@shared/calc/time'
import type { Killzone } from '@shared/schema'

const kzs = defaultKillzones()
const names = (iso: string) => killzonesAt(iso, kzs).map((k) => k.name).sort()

describe('strefy czasowe i zmiana czasu (2026: USA 8.03 / 1.11, UE 29.03 / 25.10)', () => {
  it('przed zmianą czasu: NY UTC-5, Warszawa UTC+1, różnica 6 h', () => {
    const iso = '2026-03-02T07:30:00.000Z'
    expect(formatClock(iso, 'NY')).toBe('02:30')
    expect(formatClock(iso, 'WAW')).toBe('08:30')
    expect(nyWarsawGapHours(iso)).toBe(6)
    expect(names(iso)).toEqual(['London'])
  })

  it('okno marcowe (USA już DST, UE jeszcze nie): różnica 5 h, ta sama godzina UTC wpada w SB London', () => {
    const iso = '2026-03-16T07:30:00.000Z'
    expect(formatClock(iso, 'NY')).toBe('03:30')
    expect(formatClock(iso, 'WAW')).toBe('08:30')
    expect(nyWarsawGapHours(iso)).toBe(5)
    expect(names(iso)).toEqual(['London', 'SB London'])
    expect(primaryKillzone(iso, kzs)?.name).toBe('SB London')
  })

  it('lato (obie strefy DST): różnica 6 h', () => {
    const iso = '2026-07-15T07:30:00.000Z'
    expect(formatClock(iso, 'NY')).toBe('03:30')
    expect(formatClock(iso, 'WAW')).toBe('09:30')
    expect(nyWarsawGapHours(iso)).toBe(6)
  })

  it('okno październikowe (UE już czas zimowy, USA jeszcze letni): 14:30 UTC = 10:30 NY = SB AM', () => {
    const iso = '2026-10-28T14:30:00.000Z'
    expect(formatClock(iso, 'NY')).toBe('10:30')
    expect(formatClock(iso, 'WAW')).toBe('15:30')
    expect(nyWarsawGapHours(iso)).toBe(5)
    expect(names(iso)).toEqual(['SB AM'])
  })

  it('po zmianie w USA: 14:30 UTC = 09:30 NY = killzone New York', () => {
    const iso = '2026-11-02T14:30:00.000Z'
    expect(formatClock(iso, 'NY')).toBe('09:30')
    expect(names(iso)).toEqual(['New York'])
  })

  it('granice killzone: start włącznie, koniec wyłącznie', () => {
    expect(names('2026-07-15T06:00:00.000Z')).toEqual(['London']) // 02:00 NY
    expect(names('2026-07-15T08:59:00.000Z')).toEqual(['London']) // 04:59 NY
    expect(names('2026-07-15T09:00:00.000Z')).toEqual([]) // 05:00 NY
  })

  it('killzone przez północ', () => {
    const asia: Killzone = { id: '01J0000000000000000000ASIA', name: 'Asia', start: '20:00', end: '00:00', kind: 'killzone', archived: false }
    expect(killzonesAt('2026-07-16T01:00:00.000Z', [asia]).length).toBe(1) // 21:00 NY
    expect(killzonesAt('2026-07-16T04:30:00.000Z', [asia]).length).toBe(0) // 00:30 NY
  })

  it('dzień handlowy to data w Nowym Jorku', () => {
    expect(tradingDateNy('2026-10-02T03:00:00.000Z')).toBe('2026-10-01')
    expect(tradingDateNy('2026-10-02T04:00:00.000Z')).toBe('2026-10-02')
  })
})

describe('fromLocal: wpisywanie czasu lokalnego', () => {
  it('zwykła godzina NY → UTC', () => {
    const r = fromLocal('2026-03-16', '03:30', 'NY')!
    expect(r.iso).toBe('2026-03-16T07:30:00.000Z')
    expect(r.nonexistent).toBe(false)
    expect(r.ambiguous).toBe(false)
  })

  it('godzina Warszawy → UTC w oknie różnicy 5 h', () => {
    expect(fromLocal('2026-03-16', '08:30', 'WAW')!.iso).toBe('2026-03-16T07:30:00.000Z')
  })

  it('godzina nieistniejąca (NY 8.03.2026 02:30) jest oznaczona', () => {
    const r = fromLocal('2026-03-08', '02:30', 'NY')!
    expect(r.nonexistent).toBe(true)
    expect(DateTime.fromISO(r.iso).isValid).toBe(true)
  })

  it('godzina podwójna (NY 1.11.2026 01:30) – wybierana wcześniejsza (EDT)', () => {
    const r = fromLocal('2026-11-01', '01:30', 'NY')!
    expect(r.ambiguous).toBe(true)
    expect(r.iso).toBe('2026-11-01T05:30:00.000Z')
  })

  it('godzina nieistniejąca w Warszawie (29.03.2026 02:30)', () => {
    expect(fromLocal('2026-03-29', '02:30', 'WAW')!.nonexistent).toBe(true)
  })

  it('niepoprawne dane → null', () => {
    expect(fromLocal('2026-13-01', '10:00', 'NY')).toBeNull()
  })
})
