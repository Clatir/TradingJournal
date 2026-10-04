import { describe, expect, it } from 'vitest'
import { countLabel, fmtR, fmtPips, parseClockInput, parseDateInput, parseNumberInput, plural } from '../../src/renderer/lib/format'

describe('formatowanie i parsowanie pól', () => {
  it('R i pipsy ze znakiem', () => {
    expect(fmtR(2)).toBe('+2.00R')
    expect(fmtR(-1)).toBe('−1.00R')
    expect(fmtR(-0.001)).toBe('0.00R')
    expect(fmtR(null)).toBe('—')
    expect(fmtPips(-15)).toBe('−15.0')
  })
  it('liczby z przecinkiem lub kropką', () => {
    expect(parseNumberInput('1,08535')).toBe(1.08535)
    expect(parseNumberInput(' 1.085 ')).toBe(1.085)
    expect(parseNumberInput('')).toBeNull()
    expect(parseNumberInput('1.0.8')).toBeUndefined()
    expect(parseNumberInput('abc')).toBeUndefined()
  })
  it('godziny w skróconych formatach', () => {
    expect(parseClockInput('330')).toBe('03:30')
    expect(parseClockInput('3:30')).toBe('03:30')
    expect(parseClockInput('14.05')).toBe('14:05')
    expect(parseClockInput('7')).toBe('07:00')
    expect(parseClockInput('2460')).toBeNull()
  })
  it('daty ISO i polskie', () => {
    expect(parseDateInput('2026-03-16')).toBe('2026-03-16')
    expect(parseDateInput('16.03.2026')).toBe('2026-03-16')
    expect(parseDateInput('16.3', 2026)).toBe('2026-03-16')
    expect(parseDateInput('31.02.2026')).toBeNull()
  })
})

describe('odmiana liczebników', () => {
  const cel = (n: number) => countLabel(n, 'cel', 'cele', 'celów')
  const miesiac = (n: number) => countLabel(n, 'miesiąc', 'miesiące', 'miesięcy')
  it('1, 2–4, 5+ i wyjątki 12–14', () => {
    expect([0, 1, 2, 3, 4, 5, 11, 12, 13, 14, 21, 22, 24, 25, 101, 102, 112, 122].map(cel)).toEqual([
      '0 celów', '1 cel', '2 cele', '3 cele', '4 cele', '5 celów', '11 celów', '12 celów', '13 celów', '14 celów',
      '21 celów', '22 cele', '24 cele', '25 celów', '101 celów', '102 cele', '112 celów', '122 cele'
    ])
    expect([1, 2, 5, 12, 23].map(miesiac)).toEqual(['1 miesiąc', '2 miesiące', '5 miesięcy', '12 miesięcy', '23 miesiące'])
  })

  it('ułamek: dopełniacz liczby pojedynczej; liczby ujemne jak dodatnie', () => {
    expect(countLabel(2.5, 'pips', 'pipsy', 'pipsów', 'pipsa')).toBe('2.5 pipsa')
    expect(countLabel(200, 'pips', 'pipsy', 'pipsów', 'pipsa')).toBe('200 pipsów')
    expect(countLabel(-3, 'pips', 'pipsy', 'pipsów', 'pipsa')).toBe('-3 pipsy')
    expect(plural(-1, 'pips', 'pipsy', 'pipsów', 'pipsa')).toBe('pips')
    expect(plural(0.5, 'wpłata', 'wpłaty', 'wpłat')).toBe('wpłaty')
    expect(plural(Number.NaN, 'cel', 'cele', 'celów')).toBe('celów')
    expect(countLabel(3, 'wpłata niestandardowa', 'wpłaty niestandardowe', 'wpłat niestandardowych')).toBe('3 wpłaty niestandardowe')
  })
})
