import { describe, expect, it } from 'vitest'
import {
  classifyCanonical,
  COLLECTIONS,
  detectConflictName,
  forecastRelPath,
  isIgnoredPath,
  kindOfDir,
  recordRelPath,
  sanitizeRelPath,
  screenRelPaths,
  slugLabel,
  tradeRelPath
} from '@shared/paths'

const ID = '01K6H3Z0W8Q4M2N5P7R9S1T3V5'

describe('nazwy plików', () => {
  it('ścieżka transakcji używa daty NY', () => {
    expect(tradeRelPath({ id: ID, pair: 'EURUSD', entryTime: '2026-10-02T03:00:00.000Z' })).toBe(
      `trades/2026/2026-10-01_EURUSD_${ID}.json`
    )
  })

  it('rozpoznawanie plików kanonicznych', () => {
    expect(classifyCanonical('journal.json')).toBe('journal')
    expect(classifyCanonical(`trades/2026/2026-10-01_EURUSD_${ID}.json`)).toBe('trades')
    expect(classifyCanonical('days/2026/2026-10-01.json')).toBe('days')
    expect(classifyCanonical('weeks/2026-W40.json')).toBe('weeks')
    expect(classifyCanonical(`library/${ID}.json`)).toBe('library')
    expect(classifyCanonical(`forecasts/${ID}.json`)).toBe('forecasts')
    expect(classifyCanonical('days/2026/notes.json')).toBeNull()
    expect(classifyCanonical('forecasts/scenariusz.json')).toBeNull()
    expect(classifyCanonical(`forecasts/2026/${ID}.json`)).toBeNull()
  })

  it('scenariusze prognozy: forecasts/<ULID>.json', () => {
    expect(COLLECTIONS).toContain('forecasts')
    expect(forecastRelPath(ID)).toBe(`forecasts/${ID}.json`)
    expect(recordRelPath('forecasts', { id: ID, name: 'Scenariusz 1' })).toBe(`forecasts/${ID}.json`)
    expect(kindOfDir(`forecasts/${ID}.json`)).toBe('forecasts')
    expect(isIgnoredPath(`forecasts/.${ID}.json.tmp-abc`)).toBe(true)
  })

  it('screeny: ścieżki względne, etykieta bez polskich znaków', () => {
    expect(screenRelPaths(ID, 'przed · H4', '2026-10-01')).toEqual({
      path: `screens/2026/10/${ID}_przed-H4.webp`,
      thumbPath: `screens/2026/10/${ID}_przed-H4.thumb.webp`
    })
    expect(slugLabel('W trakcie – M15 żółć')).toBe('W-trakcie-M15-zolc')
    expect(slugLabel('///')).toBe('screen')
  })

  it('pomijane ścieżki', () => {
    expect(isIgnoredPath('backups/daily/x.zip')).toBe(true)
    expect(isIgnoredPath('.presence/PC.json')).toBe(true)
    expect(isIgnoredPath('trades/2026/.x.json.tmp-abc')).toBe(true)
    expect(isIgnoredPath('trades/2026/a.json')).toBe(false)
  })

  it('ochrona przed path traversal', () => {
    expect(sanitizeRelPath('../etc/passwd')).toBeNull()
    expect(sanitizeRelPath('/abs')).toBeNull()
    expect(sanitizeRelPath('C:/Windows')).toBeNull()
    expect(sanitizeRelPath('screens\\2026\\10\\a.webp')).toBe('screens/2026/10/a.webp')
  })
})

describe('pliki konfliktów synchronizacji', () => {
  const canonical = `trades/2026/2026-10-01_EURUSD_${ID}.json`
  const cases: Array<[string, string]> = [
    [`trades/2026/2026-10-01_EURUSD_${ID}-DESKTOP-K3LM9.json`, 'OneDrive'],
    [`trades/2026/2026-10-01_EURUSD_${ID}-LAPTOP-2.json`, 'OneDrive'],
    [`trades/2026/2026-10-01_EURUSD_${ID} (conflicted copy 2026-10-02).json`, 'Dropbox'],
    [`trades/2026/2026-10-01_EURUSD_${ID} (kopia powodująca konflikt użytkownika Jan 2026-10-02).json`, 'Dropbox'],
    [`trades/2026/2026-10-01_EURUSD_${ID} (1).json`, 'Google Drive / kopia'],
    [`trades/2026/2026-10-01_EURUSD_${ID}.sync-conflict-20261002-101010-ABCDEFG.json`, 'Syncthing']
  ]
  for (const [file, source] of cases) {
    it(`${source}: ${file.split('/').pop()}`, () => {
      expect(detectConflictName(file)).toEqual({ kind: 'trades', canonicalPath: canonical, source })
    })
  }

  it('plan dnia, tydzień, biblioteka, journal.json', () => {
    expect(detectConflictName('days/2026/2026-10-01-PC.json')?.canonicalPath).toBe('days/2026/2026-10-01.json')
    expect(detectConflictName('weeks/2026-W40 (1).json')?.canonicalPath).toBe('weeks/2026-W40.json')
    expect(detectConflictName(`library/${ID}-PC.json`)?.canonicalPath).toBe(`library/${ID}.json`)
    expect(detectConflictName(`forecasts/${ID}-LAPTOP.json`)).toEqual({ kind: 'forecasts', canonicalPath: `forecasts/${ID}.json`, source: 'OneDrive' })
    expect(detectConflictName(`forecasts/${ID} (1).json`)?.canonicalPath).toBe(`forecasts/${ID}.json`)
    expect(detectConflictName('journal-DESKTOP-1.json')?.canonicalPath).toBe('journal.json')
  })

  it('pliki kanoniczne i obce nie są konfliktami', () => {
    expect(detectConflictName(canonical)).toBeNull()
    expect(detectConflictName('trades/2026/readme.json')).toBeNull()
    expect(detectConflictName('screens/2026/10/x.webp')).toBeNull()
  })
})
