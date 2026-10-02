import { describe, expect, it } from 'vitest'
import { fmtR, fmtPips, parseClockInput, parseDateInput, parseNumberInput } from '../../src/renderer/lib/format'

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
