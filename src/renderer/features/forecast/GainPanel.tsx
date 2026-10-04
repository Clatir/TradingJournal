import { firstMonthParts, type ForecastInputOutcome } from '@shared/forecast-input'
import { instrumentMinLot, selectableInstruments } from '@shared/instruments'
import type { Forecast, Settings } from '@shared/schema'
import { navigate } from '../../store/ui'
import { RateField } from '../../components/RateField'
import { CurrencyInput, Field as BaseField, Panel, Segmented, Toggle } from '../../components/ui'
import { rerollDraws, updateScenario } from './actions'
import { MONTH_NAMES, Num } from './fields'
import { fixedPipsSummary, lotHint, pipValueText } from './texts'

const SEGMENTED_MAX = 6

/** Fields of this panel have longer labels ("Tryb prognozy zysku", "Waluta scenariusza"). */
const Field = (props: Parameters<typeof BaseField>[0]) => <BaseField labelWidth={168} {...props} />

/** "Zysk i kapitał" (chapter 6.2–6.3). */
export function GainPanel({ scenario, settings, outcome }: { scenario: Forecast; settings: Settings; outcome: ForecastInputOutcome }) {
  const id = scenario.id
  const set = (patch: Partial<Forecast>) => updateScenario(id, (f) => ({ ...f, ...patch }))
  const setPct = (patch: Partial<Forecast['pct']>) => updateScenario(id, (f) => ({ ...f, pct: { ...f.pct, ...patch } }))
  const cur = scenario.currency
  const { m0, y0 } = firstMonthParts(scenario.firstMonth)
  const setFirstMonth = (month0: number, year: number) => set({ firstMonth: `${year}-${String(month0 + 1).padStart(2, '0')}` })

  return (
    <Panel title="Zysk i kapitał">
      <div className="flex flex-col gap-2" data-testid="fc-gain-panel">
        <Field label="Tryb prognozy zysku">
          <Segmented
            value={scenario.gain}
            options={[
              { value: 'pct', label: 'Procentowy' },
              { value: 'pips', label: 'Pipsowy' }
            ]}
            onChange={(gain) => set({ gain })}
            aria-label="Tryb prognozy zysku"
          />
        </Field>

        {scenario.gain === 'pct' ? (
          <>
            <Field label="Zwrot">
              <Segmented
                value={scenario.pct.mode}
                options={[
                  { value: 'fixed', label: 'Stały' },
                  { value: 'random', label: 'Losowy z zakresu' }
                ]}
                onChange={(mode) => setPct({ mode })}
                aria-label="Rodzaj zwrotu"
              />
            </Field>
            {scenario.pct.mode === 'fixed' ? (
              <Field label="Zwrot co miesiąc">
                <span className="flex items-center gap-1.5">
                  <Num value={scenario.pct.fixed} onChange={(v) => v != null && setPct({ fixed: v })} min={-100} max={100} step={0.5} aria-label="Zwrot co miesiąc" data-testid="fc-pct-fixed" />
                  <span className="text-muted">%</span>
                </span>
              </Field>
            ) : (
              <>
                <Field label="Zwrot od – do">
                  <span className="flex items-center gap-1.5">
                    <Num value={scenario.pct.lo} onChange={(v) => v != null && setPct({ lo: v })} min={-100} max={100} step={0.5} className="w-[86px]" aria-label="Zwrot od" data-testid="fc-pct-lo" />
                    <span className="text-muted">–</span>
                    <Num value={scenario.pct.hi} onChange={(v) => v != null && setPct({ hi: v })} min={-100} max={100} step={0.5} className="w-[86px]" aria-label="Zwrot do" data-testid="fc-pct-hi" />
                    <span className="text-muted">%</span>
                    <button className="btn ml-2" onClick={() => rerollDraws(id)} data-testid="fc-reroll">
                      Losuj ponownie
                    </button>
                  </span>
                </Field>
                <p className="text-[11.5px] text-muted">
                  Każdy miesiąc dostaje osobno wylosowany zwrot z tego zakresu. Losuje kryptograficzny generator systemu (<span className="num">crypto.getRandomValues</span>),
                  nie <span className="num">Math.random</span>. Wylosowane liczby zostają, kiedy zmieniasz procent wypłaty albo cele, więc porównujesz ustawienia na tym samym
                  scenariuszu.
                </p>
              </>
            )}
          </>
        ) : (
          <PipsSection scenario={scenario} settings={settings} outcome={outcome} />
        )}

        <LossSection scenario={scenario} />

        <div className="label mt-2">Kapitał i okres</div>
        <Field label="Kapitał na start" hint="w 1. miesiącu">
          <span className="flex items-center gap-1.5">
            <Num value={scenario.startCapital} onChange={(v) => v != null && set({ startCapital: v })} min={0} max={1e12} format="money" step={1000} className="w-[130px]" aria-label="Kapitał na start" data-testid="fc-start" />
            <span className="num text-muted">{cur}</span>
          </span>
        </Field>
        <Field label="Dopłata co miesiąc" hint="od 2. miesiąca; inną kwotę dla wybranego miesiąca wpiszesz w tabeli">
          <span className="flex items-center gap-1.5">
            <Num value={scenario.monthlyDeposit} onChange={(v) => v != null && set({ monthlyDeposit: v })} min={0} max={1e12} format="money" step={100} className="w-[130px]" aria-label="Dopłata co miesiąc" data-testid="fc-monthly" />
            <span className="num text-muted">{cur}</span>
          </span>
        </Field>
        <Field label="Pierwszy miesiąc">
          <span className="flex items-center gap-1.5">
            <select className="input w-[130px]" value={m0} onChange={(e) => setFirstMonth(Number(e.currentTarget.value), y0)} aria-label="Pierwszy miesiąc" data-testid="fc-first-month">
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
            <Num value={y0} onChange={(v) => v != null && setFirstMonth(m0, v)} min={1990} max={2100} format="int" step={1} className="w-[76px]" aria-label="Rok pierwszego miesiąca" data-testid="fc-first-year" />
          </span>
        </Field>
        <Field label="Liczba miesięcy" hint="od 1 do 240">
          <Num value={scenario.months} onChange={(v) => v != null && set({ months: v })} min={1} max={240} format="int" step={1} className="w-[76px]" aria-label="Liczba miesięcy" data-testid="fc-months" />
        </Field>
        <Field label="Waluta scenariusza" hint="Zmiana waluty nie przelicza kwot — zmienia tylko ich oznaczenie i kurs w trybie pipsowym.">
          <CurrencyInput className="w-[76px]" value={cur} onChange={(currency) => set({ currency })} aria-label="Waluta scenariusza" data-testid="fc-currency" />
        </Field>

        <TaxSection scenario={scenario} />
      </div>
    </Panel>
  )
}

/** "Miesiące stratne" (chapter 5.4), for both modes. */
function LossSection({ scenario }: { scenario: Forecast }) {
  const l = scenario.loss
  const setLoss = (patch: Partial<Forecast['loss']>) => updateScenario(scenario.id, (f) => ({ ...f, loss: { ...f.loss, ...patch } }))
  const pips = scenario.gain === 'pips'
  const fixedGain = pips ? scenario.pips.pipsMode === 'fixed' : scenario.pct.mode === 'fixed'
  const unit = pips ? 'pipsy' : '% kapitału'
  const lo = pips ? l.pipsLo : l.pctLo
  const hi = pips ? l.pipsHi : l.pctHi
  const max = pips ? 1e9 : 100
  return (
    <>
      <div className="label mt-2">Miesiące stratne</div>
      <Field label="Szansa na miesiąc stratny" hint="0 = bez miesięcy stratnych">
        <span className="flex items-center gap-1.5">
          <Num value={l.probability} onChange={(v) => v != null && setLoss({ probability: v })} min={0} max={100} step={1} className="w-[86px]" aria-label="Szansa na miesiąc stratny" data-testid="fc-loss-prob" />
          <span className="text-muted">%</span>
        </span>
      </Field>
      {l.probability > 0 && (
        <Field label="Strata od – do">
          <span className="flex items-center gap-1.5">
            <Num
              value={lo}
              onChange={(v) => v != null && setLoss(pips ? { pipsLo: v } : { pctLo: v })}
              min={0}
              max={max}
              step={pips ? 10 : 0.5}
              className="w-[86px]"
              aria-label="Strata od"
              data-testid="fc-loss-lo"
            />
            <span className="text-muted">–</span>
            <Num
              value={hi}
              onChange={(v) => v != null && setLoss(pips ? { pipsHi: v } : { pctHi: v })}
              min={0}
              max={max}
              step={pips ? 10 : 0.5}
              className="w-[86px]"
              aria-label="Strata do"
              data-testid="fc-loss-hi"
            />
            <span className="text-muted">{unit}</span>
            {fixedGain && (
              <button className="btn ml-2" onClick={() => rerollDraws(scenario.id)} data-testid="fc-reroll-loss">
                Losuj ponownie
              </button>
            )}
          </span>
        </Field>
      )}
    </>
  )
}

/** "Podatek od zysków" (chapter 5.5). */
function TaxSection({ scenario }: { scenario: Forecast }) {
  const t = scenario.tax
  const setTax = (patch: Partial<Forecast['tax']>) => updateScenario(scenario.id, (f) => ({ ...f, tax: { ...f.tax, ...patch } }))
  return (
    <>
      <div className="label mt-2">Podatek od zysków</div>
      <Toggle checked={t.enabled} onChange={(enabled) => setTax({ enabled })} label="Uwzględnij podatek" data-testid="fc-tax" />
      {t.enabled && (
        <>
          <Field label="Stawka">
            <span className="flex items-center gap-1.5">
              <Num value={t.ratePercent} onChange={(v) => v != null && setTax({ ratePercent: v })} min={0} max={100} step={1} className="w-[86px]" aria-label="Stawka podatku" data-testid="fc-tax-rate" />
              <span className="text-muted">%</span>
            </span>
          </Field>
          <Field label="Miesiąc zapłaty">
            <select className="input w-[150px]" value={t.payMonth} onChange={(e) => setTax({ payMonth: Number(e.currentTarget.value) })} aria-label="Miesiąc zapłaty podatku" data-testid="fc-tax-month">
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[11.5px] text-muted">
            Uproszczenie: podatek = stawka × dodatni zysk roku kalendarzowego, płatny w wybranym miesiącu następnego roku, bez rozliczania strat z lat poprzednich. To nie
            jest porada podatkowa.
          </p>
        </>
      )}
    </>
  )
}

/** Pip mode: instrument, pips, lot, pip value and the conversion rate (chapter 6.3). */
function PipsSection({ scenario, settings, outcome }: { scenario: Forecast; settings: Settings; outcome: ForecastInputOutcome }) {
  const id = scenario.id
  const p = scenario.pips
  const cur = scenario.currency
  const setPips = (patch: Partial<Forecast['pips']>) => updateScenario(id, (f) => ({ ...f, pips: { ...f.pips, ...patch } }))
  const options = selectableInstruments(settings, p.instrumentId)
  const label = (i: (typeof options)[number]) => (i.archived || !settings.instruments.some((x) => x.id === i.id) ? `${i.name} (zarchiwizowany)` : i.name)
  const instrument = outcome.ok ? outcome.instrument : outcome.reason === 'instrument' ? null : outcome.instrument
  const minLot = instrument ? instrumentMinLot(instrument, settings.risk) : settings.risk.lotStep
  const pip = outcome.ok ? outcome.pip : null
  const missingRate = !outcome.ok && outcome.reason === 'rate' ? { from: outcome.from, to: outcome.to } : null
  // The rate field converts the pip value currency into the scenario currency (hidden when they are the same).
  const rateFrom = pip ? pip.currency : missingRate?.from
  const fixed = p.pipsMode === 'fixed' && p.lotMode === 'fixed'
  const summary = pip && fixed ? fixedPipsSummary(p.pips, p.lot, pip, cur) : null

  return (
    <>
      <Field
        label="Instrument"
        hint={
          <button className="text-accent hover:underline" onClick={() => navigate({ page: 'settings', tab: 'instruments' })} data-testid="fc-manage-instruments">
            Zarządzaj instrumentami
          </button>
        }
      >
        {options.length <= SEGMENTED_MAX ? (
          <Segmented value={p.instrumentId} options={options.map((i) => ({ value: i.id, label: label(i) }))} onChange={(instrumentId) => setPips({ instrumentId })} size="sm" aria-label="Instrument" />
        ) : (
          <select className="input" value={p.instrumentId} onChange={(e) => setPips({ instrumentId: e.currentTarget.value })} aria-label="Instrument" data-testid="fc-instrument">
            {!options.some((i) => i.id === p.instrumentId) && <option value={p.instrumentId}>{p.instrumentId} (brak na liście)</option>}
            {options.map((i) => (
              <option key={i.id} value={i.id}>
                {label(i)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Pipsy w miesiącu">
        <Segmented
          value={p.pipsMode}
          options={[
            { value: 'fixed', label: 'Stałe' },
            { value: 'random', label: 'Losowe z zakresu' }
          ]}
          onChange={(pipsMode) => setPips({ pipsMode })}
          size="sm"
          aria-label="Pipsy w miesiącu"
        />
      </Field>
      {p.pipsMode === 'fixed' ? (
        <Field label="" hint="łączny wynik miesiąca w pipsach">
          <Num value={p.pips} onChange={(v) => v != null && setPips({ pips: v })} min={-1e9} max={1e9} maxDecimals={2} step={10} aria-label="Pipsy w miesiącu (stałe)" data-testid="fc-pips" />
        </Field>
      ) : (
        <Field label="" hint="każdy miesiąc dostaje osobno wylosowaną liczbę pipsów z tego zakresu (może być ujemna)">
          <span className="flex items-center gap-1.5">
            <span className="text-[11.5px] text-muted">od</span>
            <Num value={p.pipsLo} onChange={(v) => v != null && setPips({ pipsLo: v })} min={-1e9} max={1e9} maxDecimals={2} step={10} className="w-[86px]" aria-label="Pipsy od" data-testid="fc-pips-lo" />
            <span className="text-[11.5px] text-muted">do</span>
            <Num value={p.pipsHi} onChange={(v) => v != null && setPips({ pipsHi: v })} min={-1e9} max={1e9} maxDecimals={2} step={10} className="w-[86px]" aria-label="Pipsy do" data-testid="fc-pips-hi" />
            <button className="btn ml-2" onClick={() => rerollDraws(id)} data-testid="fc-reroll-pips">
              Losuj ponownie
            </button>
          </span>
        </Field>
      )}
      <Field label="Wielkość lota">
        <Segmented
          value={p.lotMode}
          options={[
            { value: 'fixed', label: 'Stały lot' },
            { value: 'perCapital', label: 'Lot na kwotę kapitału' },
            { value: 'risk', label: 'Lot z ryzyka' }
          ]}
          onChange={(lotMode) => setPips({ lotMode })}
          size="sm"
          aria-label="Wielkość lota"
        />
      </Field>
      {p.lotMode === 'fixed' && (
        <Field label="" hint={p.lot > 0 ? lotHint(p.lot, minLot) : undefined}>
          <Num
            value={p.lot}
            onChange={(v) => v != null && setPips({ lot: v })}
            min={0}
            max={1e9}
            maxDecimals={6}
            step={minLot}
            isValid={(v) => v == null || v > 0}
            aria-label="Wielkość lota (stała)"
            data-testid="fc-lot"
          />
        </Field>
      )}
      {p.lotMode === 'perCapital' && (
        <Field label="">
          <span className="flex flex-wrap items-center gap-1.5">
            <Num value={p.lotPer} onChange={(v) => v != null && setPips({ lotPer: v })} max={1e9} maxDecimals={6} step={minLot} isValid={(v) => v == null || v > 0} className="w-[80px]" aria-label="Lota na kwotę" data-testid="fc-lot-per" />
            <span className="text-[11.5px] text-muted">lota na każde</span>
            <Num value={p.lotPerAmount} onChange={(v) => v != null && setPips({ lotPerAmount: v })} max={1e12} format="money" step={100} isValid={(v) => v == null || v > 0} className="w-[100px]" aria-label="Kwota kapitału na lot" data-testid="fc-lot-per-amount" />
            <span className="text-[11.5px] text-muted">
              <span className="num">{cur}</span> kapitału
            </span>
          </span>
        </Field>
      )}
      {p.lotMode === 'risk' && (
        <>
          <Field label="Ryzyko">
            <span className="flex items-center gap-1.5">
              <Num value={p.riskPercent} onChange={(v) => v != null && setPips({ riskPercent: v })} max={100} step={0.25} isValid={(v) => v == null || v > 0} className="w-[86px]" aria-label="Ryzyko" data-testid="fc-risk" />
              <span className="text-muted">%</span>
            </span>
          </Field>
          <Field label="Stop loss">
            <span className="flex items-center gap-1.5">
              <Num value={p.stopPips} onChange={(v) => v != null && setPips({ stopPips: v })} max={1e9} step={1} isValid={(v) => v == null || v > 0} className="w-[86px]" aria-label="Stop loss w pipsach" data-testid="fc-stop" />
              <span className="text-[11.5px] text-muted">pipsy</span>
            </span>
          </Field>
        </>
      )}
      {p.lotMode !== 'fixed' && (
        <Field label="Maksymalny lot" hint="Lot liczony co miesiąc od kapitału na początku miesiąca i zaokrąglany w dół do najmniejszego lota.">
          <Num
            value={p.lotMax}
            onChange={(lotMax) => setPips({ lotMax })}
            nullable
            max={1e9}
            maxDecimals={6}
            step={minLot}
            isValid={(v) => v == null || v > 0}
            placeholder="bez limitu"
            aria-label="Maksymalny lot"
            data-testid="fc-lot-max"
          />
        </Field>
      )}
      <Field
        label="Wartość pipsa"
        hint={
          <button className="text-accent hover:underline" onClick={() => navigate({ page: 'calculator' })} data-testid="fc-to-calculator">
            Zmień w kalkulatorze
          </button>
        }
      >
        <span className="num text-[12px] text-fg-strong" data-testid="fc-pip-value">
          {pip ? pipValueText(pip, cur) : '—'}
        </span>
      </Field>
      {rateFrom && rateFrom !== cur && (
        <RateField
          label={`Kurs ${rateFrom} → ${cur}`}
          from={rateFrom}
          to={cur}
          settings={settings}
          noneHint={`ile ${cur} kosztuje 1 ${rateFrom} – wpisz ręcznie (zapamiętywany)`}
          testId="fc-rate"
        />
      )}
      {!outcome.ok ? (
        <p className="text-[12px] text-accent" data-testid="fc-pips-missing">
          {outcome.reason === 'rate'
            ? `Wpisz kurs ${outcome.from} → ${outcome.to} w polu wyżej albo wartość pipsa w kalkulatorze zysku / straty.`
            : outcome.reason === 'pip'
              ? 'Wpisz wartość pipsa w kalkulatorze zysku / straty.'
              : `Instrumentu ${outcome.instrumentId} nie ma na liście – wybierz inny.`}
        </p>
      ) : summary ? (
        <p className="text-[12px]" data-testid="fc-pips-summary">
          Zysk co miesiąc: <b className="num text-fg-strong">{summary.profit}</b>. <span className="num text-muted">{summary.detail}</span>
        </p>
      ) : (
        <p className="text-[12px] text-muted" data-testid="fc-pips-summary">
          Zysk zmienia się co miesiąc; lot i pipsy każdego miesiąca są w tabeli.
        </p>
      )}
      {outcome.ok && fixed && scenario.loss.probability === 0 && (
        <p className="text-[11.5px] text-muted">Lot i liczba pipsów są takie same w każdym miesiącu, więc zysk jest stałą kwotą i nie rośnie razem z kapitałem.</p>
      )}
    </>
  )
}
