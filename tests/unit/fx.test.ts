import { describe, expect, it } from 'vitest'
import { deviationText, expectedNbpDate, manualRateDeviation, manualRates, nbpFetchDue, nbpRate, nbpRecheckDue, parseNbpResponse, rateFor, withManualRate, withoutManualRate } from '@shared/fx'
import { calculatorCurrency, changeAccountCurrency } from '@shared/risk'
import { settingsSchema, type Settings } from '@shared/schema'

const TABLE = { no: '192/A/NBP/2026', effectiveDate: '2026-10-02', fetchedAt: '2026-10-02T12:15:00.000Z', rates: { USD: 3.8881, EUR: 4.3745, GBP: 5.1353, AUD: 2.699 } }

function settings(over: { accountCurrency?: string; conversionRates?: Record<string, number>; manual?: Record<string, number>; nbp?: typeof TABLE | null; autoFetch?: boolean } = {}): Settings {
  return settingsSchema.parse({
    risk: { accountCurrency: over.accountCurrency ?? 'PLN', conversionRates: over.conversionRates ?? {} },
    fx: { nbp: over.nbp === undefined ? TABLE : over.nbp, manual: over.manual ?? {}, autoFetch: over.autoFetch ?? true }
  })
}

describe('rateFor', () => {
  it('ta sama waluta → 1', () => {
    expect(rateFor('USD', 'USD', settings())).toEqual({ rate: 1, source: 'same' })
    expect(rateFor('PLN', 'PLN', settings({ nbp: null }))).toEqual({ rate: 1, source: 'same' })
  })

  it('kurs wpisany ręcznie dla waluty konta ma pierwszeństwo', () => {
    const s = settings({ conversionRates: { USD: 3.95 }, manual: { 'USD>PLN': 3.7 } })
    expect(rateFor('USD', 'PLN', s)).toEqual({ rate: 3.95, source: 'manual' })
  })

  it('kursy konta nie dotyczą innej waluty docelowej', () => {
    const s = settings({ conversionRates: { USD: 3.95 } })
    expect(rateFor('USD', 'EUR', s)).toEqual({ rate: 0.88881, source: 'nbp' }) // 3.8881 / 4.3745 = 0.888810…
  })

  it('kurs ręczny dla pary bez waluty konta (fx.manual)', () => {
    const s = settings({ accountCurrency: 'USD', manual: { 'EUR>PLN': 4.4 } })
    expect(rateFor('EUR', 'PLN', s)).toEqual({ rate: 4.4, source: 'manual' })
  })

  it('tabela NBP: mid(z) / mid(na), PLN = 1, zaokrąglenie do 6 miejsc', () => {
    const s = settings()
    expect(rateFor('USD', 'PLN', s)).toEqual({ rate: 3.8881, source: 'nbp' })
    expect(rateFor('PLN', 'USD', s)).toEqual({ rate: 0.257195, source: 'nbp' }) // 1 / 3.8881
    expect(rateFor('EUR', 'USD', s)).toEqual({ rate: 1.1251, source: 'nbp' }) // 4.3745 / 3.8881 = 1.125099…
    expect(rateFor('GBP', 'AUD', s)).toEqual({ rate: 1.902668, source: 'nbp' }) // 5.1353 / 2.699 = 1.9026676…
    expect(nbpRate('USD', 'PLN', s)).toBe(3.8881)
  })

  it('brak kursu: waluta spoza tabeli, brak tabeli', () => {
    expect(rateFor('CHF', 'PLN', settings())).toBeNull()
    expect(rateFor('USD', 'CHF', settings())).toBeNull()
    expect(rateFor('USD', 'PLN', settings({ nbp: null }))).toBeNull()
    expect(nbpRate('USD', 'PLN', settings({ nbp: null }))).toBeNull()
  })
})

describe('zapis kursu wpisanego ręcznie', () => {
  it('dla waluty konta w risk.conversionRates, inaczej w fx.manual', () => {
    const s = settings({ accountCurrency: 'USD' })
    const a = withManualRate(s, 'GBP', 'USD', 1.35)
    expect(a.risk.conversionRates).toEqual({ GBP: 1.35 })
    expect(a.fx.manual).toEqual({})
    const b = withManualRate(a, 'USD', 'PLN', 3.9)
    expect(b.fx.manual).toEqual({ 'USD>PLN': 3.9 })
    expect(rateFor('USD', 'PLN', b)).toEqual({ rate: 3.9, source: 'manual' })
    expect(withManualRate(b, 'USD', 'PLN', 0)).toBe(b)
    expect(manualRates(b)).toEqual([
      { from: 'GBP', to: 'USD', rate: 1.35 },
      { from: 'USD', to: 'PLN', rate: 3.9 }
    ])
  })

  it('„przywróć kurs NBP” usuwa wpis ręczny z obu miejsc', () => {
    const s = settings({ conversionRates: { USD: 3.95 }, manual: { 'USD>PLN': 3.7, 'EUR>USD': 1.1 } })
    const back = withoutManualRate(s, 'USD', 'PLN')
    expect(back.risk.conversionRates).toEqual({})
    expect(back.fx.manual).toEqual({ 'EUR>USD': 1.1 })
    expect(rateFor('USD', 'PLN', back)).toEqual({ rate: 3.8881, source: 'nbp' })
  })
})

describe('tabela NBP', () => {
  const response = [
    {
      table: 'A',
      no: '192/A/NBP/2026',
      effectiveDate: '2026-10-02',
      rates: [
        { currency: 'dolar amerykański', code: 'USD', mid: 3.8881 },
        { currency: 'euro', code: 'EUR', mid: 4.3745 },
        { currency: 'funt szterling', code: 'GBP', mid: 5.1353 },
        { currency: 'dolar australijski', code: 'AUD', mid: 2.699 },
        { currency: 'zepsuty', code: 'xx', mid: 1 },
        { currency: 'zero', code: 'ZZZ', mid: 0 }
      ]
    }
  ]

  it('parser: numer, data, kursy średnie; błędne pozycje pomijane', () => {
    expect(parseNbpResponse(response, '2026-10-02T12:15:00.000Z')).toEqual(TABLE)
  })

  it('odrzuca odpowiedzi, które nie są tabelą', () => {
    const at = '2026-10-02T12:15:00.000Z'
    expect(parseNbpResponse(null, at)).toBeNull()
    expect(parseNbpResponse({}, at)).toBeNull()
    expect(parseNbpResponse([], at)).toBeNull()
    expect(parseNbpResponse([{ ...response[0], no: '' }], at)).toBeNull()
    expect(parseNbpResponse([{ ...response[0], effectiveDate: '2.10.2026' }], at)).toBeNull()
    expect(parseNbpResponse([{ ...response[0], rates: 'USD' }], at)).toBeNull()
    expect(parseNbpResponse([{ ...response[0], rates: [{ code: 'xx', mid: 1 }] }], at)).toBeNull()
  })

  it('tabela w ustawieniach jest walidowana', () => {
    expect(() => settingsSchema.parse({ fx: { nbp: { ...TABLE, rates: { USD: -1 } } } })).toThrow()
    expect(() => settingsSchema.parse({ fx: { manual: { USDPLN: 3.9 } } })).toThrow()
    expect(settingsSchema.parse({}).fx).toEqual({ autoFetch: true, nbp: null, manual: {}, history: {} })
  })

  it('pobieranie przy starcie: tylko gdy włączone, folder zapisywalny, nie demo i tabela starsza niż 12 h', () => {
    const now = new Date('2026-10-03T08:00:00.000Z')
    const ok = { readOnly: false, isSample: false, now }
    expect(nbpFetchDue(settings({ nbp: null }), ok)).toBe(true)
    expect(nbpFetchDue(settings(), ok)).toBe(true) // fetched 19 h 45 min ago
    expect(nbpFetchDue(settings({ nbp: { ...TABLE, fetchedAt: '2026-10-02T21:00:00.000Z' } }), ok)).toBe(false) // 11 h
    expect(nbpFetchDue(settings({ autoFetch: false }), ok)).toBe(false)
    expect(nbpFetchDue(settings(), { ...ok, readOnly: true })).toBe(false)
    expect(nbpFetchDue(settings(), { ...ok, isSample: true })).toBe(false)
  })
})

describe('kursy na bieżąco (sprawdzanie co godzinę)', () => {
  it('oczekiwana tabela: dziś od 12:30 w Warszawie w dzień roboczy, inaczej poprzedni dzień roboczy', () => {
    expect(expectedNbpDate(new Date('2026-10-05T10:29:00.000Z'))).toBe('2026-10-02') // Mon 12:29 CEST → Friday
    expect(expectedNbpDate(new Date('2026-10-05T10:30:00.000Z'))).toBe('2026-10-05') // Mon 12:30 CEST
    expect(expectedNbpDate(new Date('2026-10-04T18:00:00.000Z'))).toBe('2026-10-02') // Sunday
    expect(expectedNbpDate(new Date('2026-10-06T23:30:00.000Z'))).toBe('2026-10-06') // Wed 01:30 CEST → Tuesday
    expect(expectedNbpDate(new Date('2026-12-07T11:31:00.000Z'))).toBe('2026-12-07') // CET (UTC+1): 12:31
  })

  it('sprawdzenie tylko gdy brakuje nowszej tabeli; te same warunki co przy starcie', () => {
    const ok = { readOnly: false, isSample: false }
    const friday = settings() // table of 2026-10-02 (Friday)
    expect(nbpRecheckDue(friday, { ...ok, now: new Date('2026-10-04T12:00:00.000Z') })).toBe(false) // weekend: nothing newer
    expect(nbpRecheckDue(friday, { ...ok, now: new Date('2026-10-05T09:00:00.000Z') })).toBe(false) // Monday morning
    expect(nbpRecheckDue(friday, { ...ok, now: new Date('2026-10-05T11:00:00.000Z') })).toBe(true) // Monday after 12:30
    expect(nbpRecheckDue(settings({ nbp: null }), { ...ok, now: new Date('2026-10-04T12:00:00.000Z') })).toBe(true)
    expect(nbpRecheckDue(friday, { ...ok, readOnly: true, now: new Date('2026-10-05T11:00:00.000Z') })).toBe(false)
    expect(nbpRecheckDue(friday, { ...ok, isSample: true, now: new Date('2026-10-05T11:00:00.000Z') })).toBe(false)
    expect(nbpRecheckDue(settings({ autoFetch: false }), { ...ok, now: new Date('2026-10-05T11:00:00.000Z') })).toBe(false)
  })
})

describe('changeAccountCurrency (kapitał w nowej walucie konta)', () => {
  const withBalance = (s: Settings, accountBalance: number | null): Settings => ({ ...s, risk: { ...s.risk, accountBalance } })

  it('USD → PLN: kapitał przeliczony po kursie NBP, ręczne kursy zostają przy swojej walucie', () => {
    const s = withBalance(settings({ accountCurrency: 'USD', conversionRates: { GBP: 1.3 } }), 10000)
    const { risk, balance } = changeAccountCurrency(s, 'PLN')
    expect(risk.accountCurrency).toBe('PLN')
    expect(risk.accountBalance).toBe(38881)
    expect(balance).toEqual({ before: 10000, after: 38881, rate: { rate: 3.8881, source: 'nbp' } })
    expect(risk.conversionRates).toEqual({})
    expect(risk.byAccountCurrency.USD?.conversionRates).toEqual({ GBP: 1.3 })
    // the typed "USD per GBP" rate is not used for USD → PLN
    const back = changeAccountCurrency({ ...s, risk }, 'USD')
    expect(back.risk.accountBalance).toBe(10000) // 38881 × 0.257195 = 9999.99… → 10000.00
    expect(back.risk.conversionRates).toEqual({ GBP: 1.3 })
  })

  it('kurs wpisany ręcznie (fx.manual) ma pierwszeństwo; bez kursu kapitał zostaje bez zmian', () => {
    const typed = withBalance(settings({ accountCurrency: 'USD', manual: { 'USD>PLN': 4 } }), 1000)
    expect(changeAccountCurrency(typed, 'PLN').balance).toEqual({ before: 1000, after: 4000, rate: { rate: 4, source: 'manual' } })
    const none = withBalance(settings({ accountCurrency: 'USD', nbp: null }), 1000)
    const r = changeAccountCurrency(none, 'PLN')
    expect(r.balance).toBeNull()
    expect(r.risk.accountBalance).toBe(1000)
    expect(r.risk.accountCurrency).toBe('PLN')
    expect(changeAccountCurrency(withBalance(settings({ accountCurrency: 'USD' }), null), 'PLN').balance).toBeNull()
    const same = withBalance(settings({ accountCurrency: 'PLN' }), 5)
    expect(changeAccountCurrency(same, 'PLN').risk).toBe(same.risk)
  })
})

describe('calculatorCurrency (kalkulator w PLN)', () => {
  it('domyślnie PLN: kwoty z waluty konta po kursie NBP; bez kursu waluta konta', () => {
    const usd = settings({ accountCurrency: 'USD' })
    expect(usd.risk.calcCurrency).toBe('PLN')
    expect(calculatorCurrency(usd)).toEqual({ currency: 'PLN', wanted: 'PLN', fromAccount: 3.8881, rateSource: 'nbp', fallback: false })
    expect(calculatorCurrency(settings({ accountCurrency: 'USD', nbp: null }))).toEqual({ currency: 'USD', wanted: 'PLN', fromAccount: 1, rateSource: 'same', fallback: true })
    expect(calculatorCurrency(settings({ accountCurrency: 'PLN', nbp: null }))).toMatchObject({ currency: 'PLN', fromAccount: 1, fallback: false })
    // A typed USD → PLN rate counts too.
    expect(calculatorCurrency(settings({ accountCurrency: 'USD', nbp: null, manual: { 'USD>PLN': 4 } }))).toMatchObject({ currency: 'PLN', fromAccount: 4, rateSource: 'manual' })
  })
})

describe('kurs ręczny odbiegający od NBP', () => {
  it('ostrzeżenie powyżej 3% różnicy', () => {
    const s = settings()
    expect(manualRateDeviation(3.95, 'USD', 'PLN', s)).toEqual({ nbp: 3.8881, deviation: 3.95 / 3.8881 - 1, warn: false }) // +1.6%
    const far = manualRateDeviation(4.2, 'USD', 'PLN', s)!
    expect(far.warn).toBe(true)
    expect(deviationText(far)).toBe('odbiega od NBP (3.8881) o +8.0%')
    expect(deviationText(manualRateDeviation(3.6, 'USD', 'PLN', s)!)).toBe('odbiega od NBP (3.8881) o \u22127.4%')
    expect(manualRateDeviation(4.2, 'USD', 'PLN', settings({ nbp: null }))).toBeNull()
    expect(manualRateDeviation(4.2, 'CHF', 'PLN', s)).toBeNull() // no CHF in the table
  })
})

