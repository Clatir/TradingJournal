/**
 * Scenario record (`Forecast`) + journal settings → input of the pure forecast calculation. Resolves the
 * instrument, the value of one pip for its smallest lot and the conversion to the scenario currency
 * (chapters 5.3, 14 and 15). Draws nothing and saves nothing.
 */
import type { ForecastInput } from './calc/forecast'
import { findInstrument, instrumentPipValue, missingPipValue, type PipValue } from './instruments'
import { FORECAST_MAX_MONTHS, type Forecast, type Instrument, type Settings } from './schema'

export type ForecastInputOutcome =
  | { ok: true; input: ForecastInput; instrument: Instrument | null; pip: PipValue | null }
  /** Pip mode: no rate from the pip value currency to the scenario currency. */
  | { ok: false; reason: 'rate'; from: string; to: string; instrument: Instrument }
  /** Pip mode: the instrument has no pip size and no hand-entered pip value. */
  | { ok: false; reason: 'pip'; instrument: Instrument }
  /** Pip mode: the instrument is gone from the list (and is not a preset). */
  | { ok: false; reason: 'instrument'; instrumentId: string }

/** "2026-11" → first month 0-11 and year. */
export function firstMonthParts(firstMonth: string): { m0: number; y0: number } {
  const [y, m] = firstMonth.split('-').map(Number)
  return { m0: (m ?? 1) - 1, y0: y ?? 2000 }
}

/** Custom deposits keyed by month number; keys outside 1..240 are ignored. */
export function depositsByMonth(deposits: Forecast['deposits']): Record<number, number> {
  const out: Record<number, number> = {}
  for (const [key, value] of Object.entries(deposits)) {
    const k = Number(key)
    if (Number.isInteger(k) && k >= 1 && k <= FORECAST_MAX_MONTHS) out[k] = value
  }
  return out
}

export function forecastInputFrom(scenario: Forecast, settings: Pick<Settings, 'risk' | 'fx' | 'instruments'>): ForecastInputOutcome {
  const { m0, y0 } = firstMonthParts(scenario.firstMonth)
  const input: ForecastInput = {
    keep: scenario.keep,
    payout: scenario.payoutPercent,
    start: scenario.startCapital,
    monthly: scenario.monthlyDeposit,
    horizon: scenario.months,
    m0,
    y0,
    deposits: depositsByMonth(scenario.deposits),
    goals: scenario.goals.map((g) => ({ id: g.id, name: g.name, month: g.month, amount: g.amount, on: g.enabled, flex: g.flexible })),
    gain: scenario.gain,
    pct: { mode: scenario.pct.mode, fixed: scenario.pct.fixed, lo: scenario.pct.lo, hi: scenario.pct.hi },
    loss: {
      prob: scenario.loss.probability,
      pctLo: scenario.loss.pctLo,
      pctHi: scenario.loss.pctHi,
      pipsLo: scenario.loss.pipsLo,
      pipsHi: scenario.loss.pipsHi
    },
    tax: { on: scenario.tax.enabled, rate: scenario.tax.ratePercent, payMonth: scenario.tax.payMonth },
    draws: { rate: scenario.draws.rate, loss: scenario.draws.loss, lossSize: scenario.draws.lossSize, pips: scenario.draws.pips }
  }
  if (scenario.gain !== 'pips') return { ok: true, input, instrument: null, pip: null }

  const p = scenario.pips
  const instrument = findInstrument(settings, p.instrumentId)
  if (!instrument) return { ok: false, reason: 'instrument', instrumentId: p.instrumentId }
  const pip = instrumentPipValue(instrument, settings, scenario.currency)
  if (!pip) {
    const missing = missingPipValue(instrument, settings, scenario.currency)
    return missing?.kind === 'rate'
      ? { ok: false, reason: 'rate', from: missing.from, to: missing.to, instrument }
      : { ok: false, reason: 'pip', instrument }
  }
  input.pips = {
    pipsMode: p.pipsMode,
    pips: p.pips,
    pipsLo: p.pipsLo,
    pipsHi: p.pipsHi,
    lotMode: p.lotMode,
    lot: p.lot,
    lotPer: p.lotPer,
    lotPerAmount: p.lotPerAmount,
    riskPct: p.riskPercent,
    slPips: p.stopPips,
    lotMax: p.lotMax,
    pipValueMinLot: pip.value,
    minLot: pip.minLot
  }
  return { ok: true, input, instrument, pip }
}
