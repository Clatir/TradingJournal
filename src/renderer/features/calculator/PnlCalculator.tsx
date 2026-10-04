import { create } from 'zustand'
import { PNL_PRESETS, pipValueForMinLot, pipValuePerLotFrom, presetPipValue, profitLoss, type PnlInstrumentId } from '@shared/calc/pnl'
import { lotDecimals, shownDecimals, stepDecimals } from '@shared/calc/position'
import type { Settings } from '@shared/schema'
import { fmtMoneyGrouped, tone, toneClass } from '../../lib/format'
import { updateJournal } from '../../store/journal'
import { Field, NumberField, Panel, Segmented, TextField, cx } from '../../components/ui'

interface PnlInputs {
  instrument: PnlInstrumentId
  lots: number | null
  /** Always >= 0; the sign comes from `loss`. */
  pips: number | null
  loss: boolean
}

/** Kept for the session, so leaving the screen does not reset the calculation. */
const usePnlInputs = create<PnlInputs>(() => ({ instrument: 'EURUSD', lots: 0.1, pips: 20, loss: false }))
const setInputs = (patch: Partial<PnlInputs>) => usePnlInputs.setState(patch)

type Risk = Settings['risk']
const setRisk = (fn: (r: Risk) => Risk) => updateJournal((j) => ({ ...j, settings: { ...j.settings, risk: fn(j.settings.risk) } }))

const INSTRUMENTS: Array<{ value: PnlInstrumentId; label: string }> = [
  ...PNL_PRESETS.map((p) => ({ value: p.id, label: p.label })),
  { value: 'CUSTOM', label: 'Własny' }
]

const fmtValue = (v: number, currency: string, decimals = 2) => `${v.toFixed(decimals)} ${currency}`

/** Profit / loss from lots, pips and the value of one pip for the smallest lot. */
export function PnlCalculator({ settings }: { settings: Settings }) {
  const { instrument, lots, pips, loss } = usePnlInputs()
  const risk = settings.risk
  const account = risk.accountCurrency
  const preset = PNL_PRESETS.find((p) => p.id === instrument) ?? null
  const custom = instrument === 'CUSTOM'
  const minLot = custom ? (risk.customInstrument.minLot ?? risk.lotStep) : risk.lotStep
  const quote = preset?.quoteCurrency ?? account
  const sameCurrency = quote === account
  const rate = sameCurrency ? 1 : (risk.conversionRates[quote] ?? null)
  const computed = preset ? presetPipValue(preset, { minLot, fxContractSize: risk.contractSize, quoteToAccountRate: rate }) : null
  const ownPerLot = risk.pipValuesPerLot[instrument] ?? null
  const own = ownPerLot != null ? pipValueForMinLot(ownPerLot, minLot) : null
  const pipValue = own ?? computed
  const signedPips = pips == null ? null : loss ? -Math.abs(pips) : Math.abs(pips)
  const result =
    lots != null && signedPips != null && pipValue != null ? profitLoss({ lots, pips: signedPips, pipValueMinLot: pipValue, minLot }) : null
  const balance = risk.accountBalance
  // Never hide typed digits (0.015 lota, 12.25 pipsa): the calculation uses exactly what is shown.
  const lotsDecimals = shownDecimals(lots, lotDecimals(minLot))
  const name = custom ? risk.customInstrument.name.trim() || 'własny instrument' : (preset?.label ?? '')

  /** Entered per smallest lot, stored per 1.00 lot (a later lot step change keeps the meaning). */
  const setPipValue = (v: number | null) => {
    if (v != null && !(v > 0)) return
    setRisk((r) => {
      const pipValuesPerLot = { ...r.pipValuesPerLot }
      if (v == null) delete pipValuesPerLot[instrument]
      else pipValuesPerLot[instrument] = pipValuePerLotFrom(v, minLot)
      return { ...r, pipValuesPerLot }
    })
  }

  return (
    <Panel title="Kalkulator zysku / straty" className="col-span-2" id="pnl">
      <div className="grid grid-cols-[1fr_1fr] gap-4" data-testid="pnl">
        <div className="flex flex-col gap-2">
          <Field label="Instrument">
            <Segmented value={instrument} options={INSTRUMENTS} onChange={(v) => setInputs({ instrument: v })} size="sm" aria-label="Instrument" />
          </Field>
          {custom && (
            <>
              <Field label="Nazwa">
                <TextField
                  value={risk.customInstrument.name}
                  onChange={(v) => setRisk((r) => ({ ...r, customInstrument: { ...r.customInstrument, name: v } }))}
                  placeholder="np. XAUUSD, US30, DAX"
                  data-testid="pnl-custom-name"
                />
              </Field>
              <Field label="Najmniejszy lot" hint={risk.customInstrument.minLot == null ? `jak w ustawieniach ryzyka (${risk.lotStep})` : undefined}>
                <NumberField
                  value={minLot}
                  onChange={(v) => {
                    if (v != null && !(v > 0)) return
                    setRisk((r) => ({ ...r, customInstrument: { ...r.customInstrument, minLot: v } }))
                  }}
                  decimals={stepDecimals(minLot)}
                  data-testid="pnl-min-lot"
                />
              </Field>
            </>
          )}
          <Field label="Wielkość (loty)">
            <NumberField value={lots} onChange={(v) => setInputs({ lots: v })} decimals={lotsDecimals} step={minLot} data-testid="pnl-lots" />
          </Field>
          <Field label="Pipsy">
            <div className="flex items-center gap-2">
              <NumberField
                value={pips}
                onChange={(v) => (v != null && v < 0 ? setInputs({ pips: -v, loss: true }) : setInputs({ pips: v }))}
                decimals={shownDecimals(pips, 1)}
                step={1}
                className="w-[96px]"
                data-testid="pnl-pips"
              />
              <Segmented
                value={loss ? 'loss' : 'profit'}
                options={[
                  { value: 'profit', label: 'Zysk' },
                  { value: 'loss', label: 'Strata' }
                ]}
                onChange={(v) => setInputs({ loss: v === 'loss' })}
                size="sm"
                aria-label="Zysk czy strata"
              />
            </div>
          </Field>
          {preset && !sameCurrency && (
            <Field label="Kurs" hint={`ile ${account} kosztuje 1 ${quote} – wspólny z kalkulatorem pozycji`}>
              <div className="flex items-center gap-2">
                <span className="num w-[54px] text-muted">1 {quote} =</span>
                <NumberField
                  value={rate}
                  onChange={(v) => v && v > 0 && setRisk((r) => ({ ...r, conversionRates: { ...r.conversionRates, [quote]: v } }))}
                  decimals={4}
                  step={0.0001}
                  data-testid="pnl-rate"
                />
                <span className="num text-muted">{account}</span>
              </div>
            </Field>
          )}
          <Field
            label="Wartość pipsa"
            hint={
              custom ? (
                'z platformy brokera albo specyfikacji kontraktu – zapamiętywana w ustawieniach dziennika'
              ) : own != null ? (
                <span>
                  wartość wpisana ręcznie{computed != null && ` (wyliczona: ${computed} ${account})`} ·{' '}
                  <button className="text-accent hover:underline" onClick={() => setPipValue(null)} data-testid="pnl-pip-reset">
                    przywróć wyliczoną
                  </button>
                </span>
              ) : computed != null ? (
                `wyliczona: ${preset!.pipSize} × ${(preset!.contractSize ?? risk.contractSize).toLocaleString('pl-PL')} jedn./lot × ${minLot} lota${sameCurrency ? '' : ` × kurs ${rate}`} – możesz wpisać własną`
              ) : (
                `wpisz kurs ${quote} → ${account} albo wartość pipsa`
              )
            }
          >
            <div className="flex items-center gap-2">
              <NumberField value={pipValue} onChange={setPipValue} step={0.01} placeholder="np. 0.10" className="w-[120px]" data-testid="pnl-pip-value" />
              <span className="text-muted">
                <span className="num">{account}</span> za 1 pips przy <span className="num">{minLot}</span> lota
              </span>
            </div>
          </Field>
          {preset && <p className="text-[11.5px] text-muted">{preset.description}</p>}
        </div>

        <div className="flex flex-col gap-3">
          {result ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className={cx('num text-[34px] leading-none font-medium', toneClass[tone(result.amount)])} data-testid="pnl-amount">
                  {fmtMoneyGrouped(result.amount, account)}
                </span>
                <span className="text-muted" data-testid="pnl-kind">
                  {result.amount < 0 ? 'strata' : result.amount > 0 ? 'zysk' : 'bez zmian'}
                </span>
              </div>
              <div className="grid grid-cols-2 border border-line">
                <Cell label="Wartość pipsa / pozycja" value={fmtValue(result.pipValuePosition, account, 4)} testId="pnl-pip-position" />
                <Cell label="Wartość pipsa / 1 lot" value={fmtValue(result.pipValuePerLot, account, 4)} />
                <Cell label="Pozycja" value={`${lots!.toFixed(lotsDecimals)} lota = ${Number(result.minLots.toFixed(2))} × ${minLot}`} />
                <Cell label="Względem kapitału" value={balance ? `${((result.amount / balance) * 100).toFixed(2)}%` : '—'} />
              </div>
              <p className="num text-[11.5px] text-muted">
                {name}: {signedPips! < 0 ? '−' : '+'}
                {Math.abs(signedPips!).toFixed(shownDecimals(signedPips, 1))} pips × {pipValue} {account} × {Number(result.minLots.toFixed(4))} = {fmtMoneyGrouped(result.amount, account)}
              </p>
              {!result.wholeLots && (
                <p className="text-[11.5px] text-accent" data-testid="pnl-lot-warning">
                  Wielkość pozycji nie jest wielokrotnością najmniejszego lota ({minLot}).
                </p>
              )}
            </>
          ) : (
            <div className="text-muted" data-testid="pnl-missing">
              {lots == null
                ? 'Wpisz wielkość pozycji w lotach.'
                : !(lots > 0)
                  ? 'Wielkość pozycji musi być większa od zera.'
                : pips == null
                  ? 'Wpisz liczbę pipsów.'
                  : custom
                    ? `Wpisz wartość pipsa dla ${minLot} lota.`
                    : `Wpisz kurs ${quote} → ${account} albo wartość pipsa.`}
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

function Cell({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-r border-b border-line px-2 py-1.5 [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <span className="label">{label}</span>
      <span className="num text-[13px] text-fg-strong" data-testid={testId}>
        {value}
      </span>
    </div>
  )
}
