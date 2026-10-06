/**
 * Instruments of the P/L calculator and of the pip mode of the payout forecast: smallest lot and the value
 * of one pip for it, hand-entered (risk.pipValuesPerLot, per 1.00 lot in account currency) or calculated
 * from pip size × contract size × smallest lot in the instrument's currency, converted with `rateFor`.
 */
import { pipValueForMinLot, presetPipValue } from './calc/pnl'
import { rateFor, type RateSource } from './fx'
import { presetInstruments, type Instrument, type Settings } from './schema'

type FxSettings = Pick<Settings, 'risk' | 'fx'>

export function instrumentMinLot(inst: Pick<Instrument, 'minLot'>, risk: Pick<Settings['risk'], 'lotStep'>): number {
  return inst.minLot ?? risk.lotStep
}

/** Currency of the calculated pip value (null quote currency = account currency). */
export function instrumentCurrency(inst: Pick<Instrument, 'quoteCurrency'>, risk: Pick<Settings['risk'], 'accountCurrency'>): string {
  return inst.quoteCurrency ?? risk.accountCurrency
}

export interface PipValue {
  /** Value of one pip for the smallest lot, in the target currency. */
  value: number
  /** The same before conversion, in `currency`. */
  base: number
  currency: string
  /** 1 `currency` = `rate` target currency. */
  rate: number
  rateSource: RateSource
  source: 'manual' | 'calculated'
  minLot: number
}

/** Hand-entered pip value (stored per 1.00 lot in account currency), for the smallest lot in `to`; null without it or the rate. */
export function manualPipValue(inst: Instrument, settings: FxSettings, to: string): PipValue | null {
  const perLot = settings.risk.pipValuesPerLot[inst.id]
  if (perLot == null) return null
  const minLot = instrumentMinLot(inst, settings.risk)
  const base = pipValueForMinLot(perLot, minLot)
  const account = settings.risk.accountCurrency
  const r = rateFor(account, to, settings)
  if (!r) return null
  return { value: Number((base * r.rate).toFixed(8)), base, currency: account, rate: r.rate, rateSource: r.source, source: 'manual', minLot }
}

/** Pip size × contract size × smallest lot in the instrument's currency, converted to `to`; null without a pip size or the rate. */
export function calculatedPipValue(inst: Instrument, settings: FxSettings, to: string): PipValue | null {
  if (inst.pipSize == null) return null
  const minLot = instrumentMinLot(inst, settings.risk)
  const currency = instrumentCurrency(inst, settings.risk)
  const r = rateFor(currency, to, settings)
  const opts = { minLot, fxContractSize: settings.risk.contractSize }
  const value = r ? presetPipValue(inst, { ...opts, quoteToAccountRate: r.rate }) : null
  const base = presetPipValue(inst, { ...opts, quoteToAccountRate: 1 })
  if (!r || value == null || base == null) return null
  return { value, base, currency, rate: r.rate, rateSource: r.source, source: 'calculated', minLot }
}

/** Value of one pip for the smallest lot in `to`: the hand-entered one if there is one, otherwise calculated. */
export function instrumentPipValue(inst: Instrument, settings: FxSettings, to: string): PipValue | null {
  if (settings.risk.pipValuesPerLot[inst.id] != null) return manualPipValue(inst, settings, to)
  return calculatedPipValue(inst, settings, to)
}

/** What is missing for the pip value: a conversion rate (from → to) or a pip value at all. */
export function missingPipValue(inst: Instrument, settings: FxSettings, to: string): { kind: 'rate'; from: string; to: string } | { kind: 'pip' } | null {
  if (instrumentPipValue(inst, settings, to)) return null
  if (settings.risk.pipValuesPerLot[inst.id] != null) return { kind: 'rate', from: settings.risk.accountCurrency, to }
  if (inst.pipSize == null) return { kind: 'pip' }
  return { kind: 'rate', from: instrumentCurrency(inst, settings.risk), to }
}

/** Instrument by id, also an archived one; an id of a preset that was removed from the list still resolves to the preset. */
export function findInstrument(settings: Pick<Settings, 'instruments'>, id: string): Instrument | null {
  return settings.instruments.find((i) => i.id === id) ?? presetInstruments().find((i) => i.id === id) ?? null
}

/** Not archived instruments, plus `keepId` when it is archived or gone (it is still in use). */
export function selectableInstruments(settings: Pick<Settings, 'instruments'>, keepId?: string | null): Instrument[] {
  const list = settings.instruments.filter((i) => !i.archived || i.id === keepId)
  if (keepId && !list.some((i) => i.id === keepId)) {
    const gone = findInstrument(settings, keepId)
    if (gone) list.push(gone)
  }
  return list
}

/** Identifier of a new instrument: upper-case letters and digits of its name (at most 16). */
export function instrumentIdFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/Ł/g, 'L')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
}

/** "Przywróć domyślne": presets that are missing come back, archived presets are shown again. */
export function restoreDefaultInstruments(list: readonly Instrument[]): Instrument[] {
  const presets = presetInstruments()
  const out = list.map((i) => (presets.some((p) => p.id === i.id) ? { ...i, archived: false } : i))
  for (const p of presets) if (!out.some((i) => i.id === p.id)) out.push(p)
  return out
}

/**
 * One lot of a traded pair: an instrument with the same id (Ustawienia → Instrumenty, e.g. WTI 1000) gives its contract
 * size, otherwise the account's contract size (100 000); the quote currency comes from the pair (or the instrument).
 */
export function lotValueFor(pair: string, settings: Pick<Settings, 'pairs' | 'instruments' | 'risk'>): { contractSize: number; quoteCurrency: string } | null {
  const cfg = settings.pairs.find((p) => p.symbol === pair)
  const inst = settings.instruments.find((i) => i.id === pair)
  const quoteCurrency = cfg?.quoteCurrency || inst?.quoteCurrency || null
  if (!quoteCurrency) return null
  return { contractSize: cfg?.contractSize ?? inst?.contractSize ?? settings.risk.contractSize, quoteCurrency }
}
