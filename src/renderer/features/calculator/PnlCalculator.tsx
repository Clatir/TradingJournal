import { create } from 'zustand'
import { pipValueForMinLot, pipValuePerLotFrom, profitLoss } from '@shared/calc/pnl'
import { lotDecimals, shownDecimals } from '@shared/calc/position'
import { rateFor } from '@shared/fx'
import { calculatedPipValue, instrumentCurrency, instrumentMinLot, selectableInstruments } from '@shared/instruments'
import type { Settings } from '@shared/schema'
import { fmtMoneyGrouped, tone, toneClass } from '../../lib/format'
import { updateJournal } from '../../store/journal'
import { navigate } from '../../store/ui'
import { RateField } from '../../components/RateField'
import { Cell, Field, NumberField, Panel, Segmented, cx } from '../../components/ui'

interface PnlInputs {
  /** Instrument id from settings.instruments. */
  instrument: string
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

/** At most this many instruments are shown as buttons; more make a list. */
const SEGMENTED_MAX = 6

const fmtValue = (v: number, currency: string, decimals = 2) => `${v.toFixed(decimals)} ${currency}`

/** Profit / loss from lots, pips and the value of one pip for the smallest lot. */
export function PnlCalculator({ settings }: { settings: Settings }) {
  const { instrument: selectedId, lots, pips, loss } = usePnlInputs()
  const risk = settings.risk
  const account = risk.accountCurrency
  // Only instruments that are not archived; an archived selection falls back to the first one on the list.
  const options = selectableInstruments(settings)
  const inst = options.find((i) => i.id === selectedId) ?? options[0] ?? null

  const manageLink = (
    <button className="text-accent hover:underline" onClick={() => navigate({ page: 'settings', tab: 'instruments' })} data-testid="pnl-manage">
      Zarządzaj instrumentami
    </button>
  )
  if (!inst)
    return (
      <Panel title="Kalkulator zysku / straty" className="col-span-2" id="pnl">
        <div className="text-muted" data-testid="pnl">
          Brak instrumentów na liście. {manageLink}
        </div>
      </Panel>
    )

  const minLot = instrumentMinLot(inst, risk)
  const quote = instrumentCurrency(inst, risk)
  const sameCurrency = quote === account
  const rate = rateFor(quote, account, settings)?.rate ?? null
  const computed = calculatedPipValue(inst, settings, account)?.value ?? null
  const ownPerLot = risk.pipValuesPerLot[inst.id] ?? null
  const own = ownPerLot != null ? pipValueForMinLot(ownPerLot, minLot) : null
  const pipValue = own ?? computed
  const calculable = inst.pipSize != null
  const signedPips = pips == null ? null : loss ? -Math.abs(pips) : Math.abs(pips)
  const result =
    lots != null && signedPips != null && pipValue != null ? profitLoss({ lots, pips: signedPips, pipValueMinLot: pipValue, minLot }) : null
  const balance = risk.accountBalance
  // Never hide typed digits (0.015 lota, 12.25 pipsa): the calculation uses exactly what is shown.
  const lotsDecimals = shownDecimals(lots, lotDecimals(minLot))

  /** Entered per smallest lot, stored per 1.00 lot (a later lot step change keeps the meaning). */
  const setPipValue = (v: number | null) => {
    if (v != null && !(v > 0)) return
    setRisk((r) => {
      const pipValuesPerLot = { ...r.pipValuesPerLot }
      if (v == null) delete pipValuesPerLot[inst.id]
      else pipValuesPerLot[inst.id] = pipValuePerLotFrom(v, minLot)
      return { ...r, pipValuesPerLot }
    })
  }

  return (
    <Panel title="Kalkulator zysku / straty" className="col-span-2" id="pnl">
      <div className="grid grid-cols-[1fr_1fr] gap-4" data-testid="pnl">
        <div className="flex flex-col gap-2">
          <Field label="Instrument" hint={manageLink}>
            {options.length <= SEGMENTED_MAX ? (
              <Segmented
                value={inst.id}
                options={options.map((i) => ({ value: i.id, label: i.name }))}
                onChange={(v) => setInputs({ instrument: v })}
                size="sm"
                aria-label="Instrument"
              />
            ) : (
              <select className="input" value={inst.id} onChange={(e) => setInputs({ instrument: e.currentTarget.value })} aria-label="Instrument" data-testid="pnl-instrument">
                {options.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
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
          {calculable && !sameCurrency && (
            <RateField from={quote} to={account} settings={settings} noneHint={`ile ${account} kosztuje 1 ${quote} – wspólny z kalkulatorem pozycji`} testId="pnl-rate" />
          )}
          <Field
            label="Wartość pipsa"
            hint={
              !calculable ? (
                'z platformy brokera albo specyfikacji kontraktu – zapamiętywana w ustawieniach dziennika'
              ) : own != null ? (
                <span>
                  wartość wpisana ręcznie{computed != null && ` (wyliczona: ${computed} ${account})`} ·{' '}
                  <button className="text-accent hover:underline" onClick={() => setPipValue(null)} data-testid="pnl-pip-reset">
                    przywróć wyliczoną
                  </button>
                </span>
              ) : computed != null ? (
                `wyliczona: ${inst.pipSize} × ${(inst.contractSize ?? risk.contractSize).toLocaleString('pl-PL')} jedn./lot × ${minLot} lota${sameCurrency ? '' : ` × kurs ${rate}`} – możesz wpisać własną`
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
          {inst.description && <p className="text-[11.5px] text-muted">{inst.description}</p>}
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
                {inst.name}: {signedPips! < 0 ? '−' : '+'}
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
                    : !calculable
                      ? `Wpisz wartość pipsa dla ${minLot} lota.`
                      : `Wpisz kurs ${quote} → ${account} albo wartość pipsa.`}
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}
