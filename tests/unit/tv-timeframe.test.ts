import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGEND_OCR, intervalFromWords, intervalName, normalizeInterval, readTimeframe, voteTimeframe } from '@shared/import/tvTimeframe'
import type { OcrWord } from '@shared/import/xtbScreen'
import { loadPng, ocrGray } from './helpers/tvScreens'

let x = 0
/** One OCR line of words placed left to right. */
const line = (texts: string[], id = '1.1.1', top = 10): OcrWord[] => {
  x = 0
  return texts.map((text) => {
    const w = { text, left: x, top, width: text.length * 8, height: 12, conf: 90, line: id }
    x += w.width + 6
    return w
  })
}

describe('TradingView interval', () => {
  it('normalizes what TradingView writes and the usual OCR misreadings', () => {
    expect(normalizeInterval('1h')).toBe('1h')
    expect(normalizeInterval('Th')).toBe('1h')
    expect(normalizeInterval('th')).toBe('1h')
    expect(normalizeInterval('Ih')).toBe('1h')
    expect(normalizeInterval('4n')).toBe('4h')
    expect(normalizeInterval('15')).toBe('15')
    expect(normalizeInterval('15m')).toBe('15m')
    expect(normalizeInterval('1D')).toBe('1D')
    expect(normalizeInterval('W')).toBe('W')
    expect(normalizeInterval('1O')).toBe('10')
    // Not intervals: words, a lone misread letter, absurd values.
    expect(normalizeInterval('OANDA')).toBeNull()
    expect(normalizeInterval('T')).toBeNull()
    expect(normalizeInterval('0')).toBeNull()
    expect(normalizeInterval('99h')).toBeNull()
  })

  it('names intervals as the journal does', () => {
    expect(['1', '5', '15', '15m', '30', '60', '120', '1h', '4h', '1D', 'D', '2D', '1W', 'W', '1M', 'M', '30s'].map(intervalName)).toEqual([
      'M1',
      'M5',
      'M15',
      'M15',
      'M30',
      'H1',
      'H2',
      'H1',
      'H4',
      'D',
      'D',
      'D2',
      'W',
      'W',
      'MN',
      'MN',
      'S30'
    ])
  })

  it('finds the interval between the dots of the legend line, not elsewhere', () => {
    const words = [
      ...line(['Szy_Monk', 'created', 'with', 'TradingView.com,', 'Oct', '08,', '2026'], '1.1.1', 5),
      ...line(['Euro', '/', 'British', 'Pound', '-', 'Th', '-', 'QANDA', 'O0.84770'], '1.2.1', 30),
      ...line(['Fair', 'Value', 'Gap', '(D,', 'Current', 'TF,', '10,', '20)'], '1.3.1', 50)
    ]
    expect(intervalFromWords(words)).toBe('1h')
    expect(intervalFromWords(line(['Euro', '/', 'Dollar', '·15·', 'OANDA']))).toBe('15')
    // A number without the dots around it is no interval (the indicator's settings, prices).
    expect(intervalFromWords(line(['Fair', 'Value', 'Gap', '(D,', 'Current', 'TF,', '10,', '20)']))).toBeNull()
    expect(intervalFromWords([])).toBeNull()
  })

  it('is certain only when readings agree', () => {
    expect(voteTimeframe(['1h', '1h', '1h'])).toMatchObject({ name: 'H1', certain: true })
    expect(voteTimeframe(['1h', null, '1h'])).toMatchObject({ name: 'H1', certain: true })
    expect(voteTimeframe([null, '1h', null])).toMatchObject({ name: 'H1', certain: false })
    // A stray misreading against three agreeing ones; two against one is not enough.
    expect(voteTimeframe(['1h', '1h', '7h', '1h'])).toMatchObject({ name: 'H1', certain: true })
    expect(voteTimeframe(['1h', '1h', '7h'])).toMatchObject({ name: 'H1', certain: false })
    // A tie is no answer, nothing read is nothing.
    expect(voteTimeframe(['1h', '4h'])).toMatchObject({ name: null, certain: false })
    expect(voteTimeframe([null, null])).toMatchObject({ name: null, tv: null, certain: false })
  })
})

describe('timeframe from synthetic legends (OCR)', () => {
  const dir = join(__dirname, '../fixtures/tv-legend')
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'))
  it('has fixtures', () => expect(files.length).toBeGreaterThanOrEqual(8))
  for (const f of files)
    it(f, { timeout: 60_000 }, async () => {
      const expected = intervalName(/^legend-([^-]+)/.exec(f)![1]!)
      const r = await readTimeframe(loadPng(join(dir, f)), (g) => ocrGray(g, LEGEND_OCR.psm, LEGEND_OCR.whitelist))
      expect(r.name).toBe(expected)
      expect(r.certain).toBe(true)
    })

  it('reads nothing from a picture without a TradingView legend', { timeout: 60_000 }, async () => {
    const r = await readTimeframe(loadPng(join(__dirname, '../fixtures/xtb-position.png')), (g) => ocrGray(g, LEGEND_OCR.psm, LEGEND_OCR.whitelist))
    expect(r.name).toBeNull()
  })
})
