import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { MAX_PARTIALS, partialPercents, partialPlan, type PartialSpec, type PlanScenario } from '@shared/calc/partials'
import { optimalSplit, type OptimalCriterion } from '@shared/calc/partialsOptimal'
import { lotDecimals, shownDecimals } from '@shared/calc/position'
import { findInstrument, instrumentPipValue, missingPipValue, selectableInstruments } from '@shared/instruments'
import { calculatorCurrency } from '@shared/risk'
import type { Settings } from '@shared/schema'
import { fmtMoney, fmtR, tone, toneClass } from '../../lib/format'
import { Field, NumberField, Panel, Segmented, Toggle, cx } from '../../components/ui'

interface PartialsInputs {
  instrument: string
  lots: number | null
  stopPips: number | null
  nowPips: number | null
  breakeven: boolean
  parts: PartialSpec[]
  /** "Optymalny podział": criterion and the allowed loss (R) of 'maxLoss'. */
  optCriterion: OptimalCriterion
  optMaxLossR: number | null
}

/** Kept for the session, so leaving the screen does not reset the comparison. */
const usePartials = create<PartialsInputs>(() => ({
  instrument: 'EURUSD',
  lots: 1,
  stopPips: 20,
  nowPips: 30,
  breakeven: false,
  optCriterion: 'ev',
  optMaxLossR: 0.5,
  parts: [
    { mode: 'now', percent: 50, targetPips: null },
    { mode: 'target', percent: null, targetPips: 60, probability: 100 }
  ]
}))
const set = (patch: Partial<PartialsInputs>) => usePartials.setState(patch)
const setPart = (k: number, patch: Partial<PartialSpec>) => usePartials.setState((s) => ({ parts: s.parts.map((p, i) => (i === k ? { ...p, ...patch } : p)) }))

const SEGMENTED_MAX = 6
const pipsText = (p: number) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} pips`

/**
 * "Partiale": close the whole open position now, or split it into up to 4 parts (now or at targets). Shows the
 * result of every choice: closing now, each part, and every outcome of the split (0, 1, … targets reached) with its
 * chance; the expected result of the split decides which choice is suggested.
 */
export function PartialsCalculator({ settings, from }: { settings: Settings; from?: { key: string; instrument: string | null; lots: number | null; stopPips: number | null } }) {
  const { instrument: selectedId, lots, stopPips, nowPips, breakeven, parts } = usePartials()
  // Amounts in the calculator currency (PLN by default), like the other calculators of the page.
  const account = calculatorCurrency(settings).currency

  // Opened from a trade: its instrument (when it is on the list), lots and stop.
  const fromKey = from?.key ?? null
  useEffect(() => {
    if (!from) return
    set({
      ...(from.instrument && findInstrument(settings, from.instrument) ? { instrument: from.instrument } : {}),
      ...(from.lots != null ? { lots: from.lots } : {}),
      ...(from.stopPips != null ? { stopPips: from.stopPips } : {})
    })
    // Only when another trade is opened (not on every render of the same one).
  }, [fromKey])

  const options = selectableInstruments(settings)
  const inst = options.find((i) => i.id === selectedId) ?? options[0] ?? null
  const pip = inst ? instrumentPipValue(inst, settings, account) : null
  const missing = inst && !pip ? missingPipValue(inst, settings, account) : null
  const lotStep = settings.risk.lotStep
  const lotDec = lotDecimals(lotStep)
  const percents = partialPercents(parts)

  const outcome =
    pip && lots != null && stopPips != null && nowPips != null
      ? partialPlan({ lots, lotStep, minLot: pip.minLot, pipValueMinLot: pip.value, stopPips, nowPips, breakevenAfterFirst: breakeven, parts })
      : null
  const plan = outcome?.ok ? outcome.plan : null
  const money = (v: number) => fmtMoney(v, account)
  const valueClass = (v: number) => toneClass[tone(v)]

  const addPart = () =>
    usePartials.setState((s) => {
      if (s.parts.length >= MAX_PARTIALS) return s
      // Even shares again (33 / 33 / reszta 34); the new last part takes the rest at a target one stop further.
      const share = Math.floor(100 / (s.parts.length + 1))
      const prev = s.parts.map((p) => ({ ...p, percent: share }))
      const lastTarget = Math.max(s.nowPips ?? 0, ...s.parts.map((p) => p.targetPips ?? -Infinity))
      return { parts: [...prev, { mode: 'target', percent: null, targetPips: Math.round(lastTarget + (s.stopPips ?? 20)), probability: 100 }] }
    })
  const removePart = (k: number) => usePartials.setState((s) => (s.parts.length <= 1 ? s : { parts: s.parts.filter((_, i) => i !== k) }))

  const scenarioLabel = (s: PlanScenario, targets: number[]) => {
    const rest = s.restPips === 0 ? 'reszta na BE' : `reszta na SL (${pipsText(-(stopPips ?? 0))})`
    if (s.restPips == null) return targets.length ? 'wszystkie cele osiągnięte' : 'wszystko zamknięte teraz'
    if (s.reached === 0) return `cena wraca przed pierwszym celem – ${rest}`
    return `osiągnięty cel ${pipsText(targets[s.reached - 1]!)} – ${rest}`
  }

  return (
    <Panel title="Partiale – zamknąć teraz czy podzielić?" className="col-span-2" id="partials">
      <div className="grid grid-cols-[1fr_1fr] gap-4" data-testid="partials">
        <div className="flex flex-col gap-2">
          <Field label="Instrument">
            {options.length <= SEGMENTED_MAX ? (
              <Segmented value={inst?.id ?? null} options={options.map((i) => ({ value: i.id, label: i.name }))} onChange={(v) => set({ instrument: v })} size="sm" aria-label="Instrument partiali" />
            ) : (
              <select className="input" value={inst?.id ?? ''} onChange={(e) => set({ instrument: e.currentTarget.value })} aria-label="Instrument partiali" data-testid="part-instrument">
                {options.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Pozycja (loty)">
            <NumberField value={lots} onChange={(v) => set({ lots: v != null && v > 0 ? v : null })} decimals={shownDecimals(lots, lotDec)} step={lotStep} data-testid="part-lots" />
          </Field>
          <Field label="SL (pips)" hint="odległość stop lossa od wejścia – strata całej pozycji to 1R">
            <NumberField value={stopPips} onChange={(v) => set({ stopPips: v != null && v > 0 ? v : null })} decimals={shownDecimals(stopPips, 1)} step={1} data-testid="part-sl" />
          </Field>
          <Field label="Wynik teraz (pips)" hint="ile pipsów pozycja ma w tej chwili (strata z minusem)">
            <NumberField value={nowPips} onChange={(v) => set({ nowPips: v })} decimals={shownDecimals(nowPips, 1)} step={1} data-testid="part-now" />
          </Field>
          <span data-testid="part-be">
            <Toggle checked={breakeven} onChange={(v) => set({ breakeven: v })} label="po pierwszym partialu w zysku SL reszty na BE (wejście)" />
          </span>

          <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-2">
            {parts.map((p, k) => {
              const last = k === parts.length - 1
              return (
                <div key={k} className="flex flex-wrap items-center gap-2" data-testid={`part-${k + 1}`}>
                  <span className="w-[46px] text-[11.5px] text-muted">Część {k + 1}</span>
                  <Segmented
                    value={p.mode}
                    options={[
                      { value: 'now', label: 'Teraz' },
                      { value: 'target', label: 'Cel' }
                    ]}
                    onChange={(mode) =>
                      setPart(k, {
                        mode,
                        targetPips: mode === 'target' ? (p.targetPips ?? Math.round((nowPips ?? 0) + (stopPips ?? 20))) : p.targetPips,
                        probability: p.probability ?? 100
                      })
                    }
                    size="sm"
                    aria-label={`Część ${k + 1}`}
                  />
                  {last ? (
                    <span className="num w-[80px] text-right text-[12px] whitespace-nowrap text-muted" data-testid={`part-${k + 1}-pct`}>
                      {parts.length === 1 ? 'całość' : `reszta ${Number(percents[k]!.toFixed(2))}%`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <NumberField
                        value={p.percent}
                        onChange={(v) => setPart(k, { percent: v != null && v > 0 && v < 100 ? v : null })}
                        decimals={shownDecimals(p.percent, 0)}
                        step={5}
                        className="w-[52px]"
                        aria-label={`Udział części ${k + 1} w procentach`}
                        data-testid={`part-${k + 1}-pct`}
                      />
                      <span className="text-[11.5px] text-muted">%</span>
                    </span>
                  )}
                  {p.mode === 'target' && (
                    <span className="flex items-center gap-1">
                      <span className="text-[11.5px] text-muted">na</span>
                      <NumberField
                        value={p.targetPips}
                        onChange={(v) => setPart(k, { targetPips: v })}
                        decimals={shownDecimals(p.targetPips, 1)}
                        step={5}
                        className="w-[60px]"
                        aria-label={`Cel części ${k + 1} w pipsach`}
                        data-testid={`part-${k + 1}-target`}
                      />
                      <span className="text-[11.5px] text-muted">pips</span>
                    </span>
                  )}
                  {p.mode === 'target' && (
                    <span className="flex items-center gap-1" title="Szansa, że cena dojdzie do tego celu (domyślnie 100%)">
                      <span className="text-[11.5px] text-muted">szansa</span>
                      <NumberField
                        value={p.probability ?? 100}
                        onChange={(v) => setPart(k, { probability: v != null && v >= 0 && v <= 100 ? v : 100 })}
                        isValid={(v) => v == null || (v >= 0 && v <= 100)}
                        decimals={shownDecimals(p.probability ?? 100, 0)}
                        step={5}
                        className="w-[48px]"
                        aria-label={`Szansa osiągnięcia celu części ${k + 1} w procentach`}
                        data-testid={`part-${k + 1}-chance`}
                      />
                      <span className="text-[11.5px] text-muted">%</span>
                    </span>
                  )}
                  {parts.length > 1 && (
                    <button className="btn btn-ghost ml-auto h-[22px] px-1.5 text-[14px] leading-none" onClick={() => removePart(k)} aria-label={`Usuń część ${k + 1}`} data-testid={`part-${k + 1}-del`}>
                      ×
                    </button>
                  )}
                </div>
              )
            })}
            <button className="btn self-start" disabled={parts.length >= MAX_PARTIALS} onClick={addPart} data-testid="part-add">
              {parts.length >= MAX_PARTIALS ? `Limit: ${MAX_PARTIALS} partiale` : '+ Dodaj partial'}
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {!inst ? (
            <p className="text-muted">Brak instrumentów na liście.</p>
          ) : !pip ? (
            <p className="text-accent" data-testid="part-missing">
              {missing?.kind === 'rate'
                ? `Brak kursu ${missing.from} → ${missing.to} – wpisz go w kalkulatorze zysku / straty (pole „Kurs”).`
                : 'Wpisz wartość pipsa tego instrumentu w kalkulatorze zysku / straty.'}
            </p>
          ) : outcome && !outcome.ok ? (
            <p className="text-accent" data-testid="part-error">
              {outcome.error}
            </p>
          ) : !plan ? (
            <p className="text-muted">Uzupełnij pozycję, SL i obecny wynik.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 border border-line">
                <div className="flex flex-col gap-0.5 border-r border-line px-2 py-1.5">
                  <span className="label">Zamknij całość teraz</span>
                  <span className={cx('num text-[18px] font-medium', valueClass(plan.closeNow.amount))} data-testid="part-close-now">
                    {money(plan.closeNow.amount)}
                  </span>
                  <span className="num text-[11.5px] text-muted">
                    {fmtR(plan.closeNow.r)} · {pipsText(plan.closeNow.pips)} · pewne
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 px-2 py-1.5">
                  <span className="label">Podziel na partiale</span>
                  <span className="num text-[13px]">
                    najlepiej <b className={cx('font-medium', valueClass(plan.best.amount))} data-testid="part-best">{money(plan.best.amount)}</b>{' '}
                    <span className="text-muted">({fmtR(plan.best.r)})</span>
                  </span>
                  <span className="num text-[13px]">
                    najgorzej <b className={cx('font-medium', valueClass(plan.worst.amount))} data-testid="part-worst">{money(plan.worst.amount)}</b>{' '}
                    <span className="text-muted">({fmtR(plan.worst.r)})</span>
                  </span>
                  <span className="num text-[13px]" title="Średnia wyników wszystkich scenariuszy ważona ich szansą">
                    oczekiwany <b className={cx('font-medium', valueClass(plan.expected.amount))} data-testid="part-expected">{money(plan.expected.amount)}</b>{' '}
                    <span className="text-muted">({fmtR(plan.expected.r)})</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1 border border-accent/60 bg-accent-soft px-2.5 py-2" data-testid="part-suggestion">
                <span className="text-[13px] text-fg-strong">{suggestion(plan, money)}</span>
                {suggestionNote(plan) && <span className="text-[11.5px] text-muted">{suggestionNote(plan)}</span>}
              </div>

              {plan.final && <FinalTarget final={plan.final} money={money} />}

              <table className="num w-full border-collapse text-[12px]" data-testid="part-rows">
                <thead>
                  <tr className="text-[11px] text-muted">
                    <th className="border-b border-line py-1 text-left font-medium">Część</th>
                    <th className="border-b border-line py-1 pl-2 text-right font-medium">Loty</th>
                    <th className="border-b border-line py-1 pl-2 text-right font-medium">Zamknięcie</th>
                    <th className="border-b border-line py-1 pl-2 text-right font-medium">Szansa</th>
                    <th className="border-b border-line py-1 pl-2 text-right font-medium">Wynik części</th>
                    {plan.final && (
                      <th className="border-b border-line py-1 pl-2 text-right font-medium whitespace-nowrap" title={`Ile ta część traci względem zamknięcia całości na ostatnim celu (${pipsText(plan.final.pips)}), gdy cena tam dojdzie`}>
                        vs TP {pipsText(plan.final.pips).replace(' pips', '')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={row.n} data-testid={`part-row-${row.n}`}>
                      <td className="border-b border-line/60 py-1 font-sans whitespace-nowrap">
                        {row.n} <span className="text-dim">({Number(row.percent.toFixed(2))}%)</span>
                      </td>
                      <td className="border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap">{row.lots.toFixed(lotDec)}</td>
                      <td className="border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap">{row.mode === 'now' ? `teraz ${pipsText(row.pips)}` : `cel ${pipsText(row.pips)}`}</td>
                      <td
                        className={cx('border-b border-line/60 py-1 pl-2 text-right', row.probabilityLowered && 'text-accent')}
                        title={row.probabilityLowered ? 'Obniżona do szansy bliższego celu – cena musi przez niego przejść' : undefined}
                        data-testid={`part-row-${row.n}-chance`}
                      >
                        {row.mode === 'now' ? 'pewne' : chanceText(row.probability)}
                        {row.probabilityLowered ? '*' : ''}
                      </td>
                      <td className={cx('border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap', valueClass(row.amount))}>
                        {money(row.amount)} <span className="text-dim">{fmtR(row.r)}</span>
                      </td>
                      {plan.final && (
                        <td
                          className={cx('border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap', row.costVsFinal < 0.005 ? 'text-muted' : valueClass(-row.costVsFinal))}
                          data-testid={`part-row-${row.n}-cost`}
                        >
                          {row.costVsFinal < 0.005 ? '—' : money(-row.costVsFinal)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <table className="num w-full border-collapse text-[12px]" data-testid="part-scenarios">
                <thead>
                  <tr className="text-[11px] text-muted">
                    <th className="border-b border-line py-1 text-left font-medium">Gdy</th>
                    <th className="border-b border-line py-1 text-right font-medium">Szansa</th>
                    <th className="border-b border-line py-1 text-right font-medium">Razem</th>
                    <th className="border-b border-line py-1 pl-2 text-right font-medium whitespace-nowrap">vs zamknięcie teraz</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.scenarios.map((s) => {
                    const targets = plan.rows.filter((r) => r.mode === 'target').map((r) => r.pips).sort((a, b) => a - b)
                    return (
                      <tr key={s.reached} data-testid={`part-scenario-${s.reached}`}>
                        <td className="border-b border-line/60 py-1 font-sans text-[11.5px]">{scenarioLabel(s, targets)}</td>
                        <td className={cx('border-b border-line/60 py-1 pl-2 text-right', s.probability < 1e-9 && 'text-dim')} data-testid={`part-scenario-${s.reached}-chance`}>
                          {chanceText(s.probability)}
                        </td>
                        <td className={cx('border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap', valueClass(s.amount))}>
                          {money(s.amount)} <span className="text-dim">{fmtR(s.r)}</span>
                        </td>
                        <td className={cx('border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap', Math.abs(s.vsNow) < 0.005 ? 'text-muted' : valueClass(s.vsNow))}>
                          {Math.abs(s.vsNow) < 0.005 ? 'tyle samo' : money(s.vsNow)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <p className="text-[12px]" data-testid="part-verdict">
                {verdict(plan, money)}
              </p>
            </>
          )}
        </div>
        {pip && lots != null && stopPips != null && nowPips != null && (
          <OptimalSection
            input={{ lots, lotStep, minLot: pip.minLot, pipValueMinLot: pip.value, stopPips, nowPips, breakevenAfterFirst: breakeven, parts }}
            currentExpected={plan?.expected.amount ?? null}
            money={money}
            lotDec={lotDec}
          />
        )}
      </div>
    </Panel>
  )
}

const CRITERIA: Array<{ value: OptimalCriterion; label: string; title: string }> = [
  { value: 'ev', label: 'Najwyższy oczekiwany wynik', title: 'Maksimum Σ szansa × wynik – bez ograniczenia ryzyka' },
  { value: 'noLoss', label: 'Bez straty', title: 'Najwyższy oczekiwany wynik, przy którym najgorszy możliwy przypadek nie jest stratą' },
  { value: 'maxLoss', label: 'Strata najwyżej', title: 'Najwyższy oczekiwany wynik, przy którym najgorszy możliwy przypadek traci najwyżej podaną liczbę R' }
]

/**
 * "Optymalny podział": how much to close now and at each target (from the targets and chances above) for the chosen
 * criterion; the value of every target on its own and the chance it needs to beat closing now; "Zastosuj" puts the
 * split into the calculator.
 */
function OptimalSection({
  input,
  currentExpected,
  money,
  lotDec
}: {
  input: { lots: number; lotStep: number; minLot: number; pipValueMinLot: number; stopPips: number; nowPips: number; breakevenAfterFirst: boolean; parts: PartialSpec[] }
  currentExpected: number | null
  money: (v: number) => string
  lotDec: number
}) {
  const criterion = usePartials((s) => s.optCriterion)
  const maxLossR = usePartials((s) => s.optMaxLossR)
  const targets = input.parts.filter((p) => p.mode === 'target' && p.targetPips != null).map((p) => ({ pips: p.targetPips!, probability: p.probability ?? 100 }))
  const key = JSON.stringify([input.lots, input.lotStep, input.minLot, input.pipValueMinLot, input.stopPips, input.nowPips, input.breakevenAfterFirst, targets, criterion, maxLossR])
  // Recomputed only when an input of the search changes (the key), not on every render.
  const out = useMemo(() => optimalSplit({ ...input, targets, criterion, maxLossR: maxLossR ?? undefined }), [key])
  const abs = (v: number) => money(Math.abs(v)).replace(/^[+−-]/, '')
  const pct = (p: number) => `${Number((p * 100).toFixed(1))}%`
  return (
    <div className="col-span-2 flex flex-col gap-2 border-t border-line pt-3" data-testid="part-optimal">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Optymalny podział</span>
        <Segmented size="sm" value={criterion} options={CRITERIA} onChange={(v) => set({ optCriterion: v })} aria-label="Kryterium optymalnego podziału" />
        {criterion === 'maxLoss' && (
          <span className="flex items-center gap-1">
            <NumberField
              value={maxLossR}
              onChange={(v) => set({ optMaxLossR: v != null && v >= 0 ? v : null })}
              isValid={(v) => v == null || v >= 0}
              decimals={shownDecimals(maxLossR, 1)}
              step={0.1}
              className="w-[56px]"
              aria-label="Dopuszczalna strata w R"
              data-testid="opt-maxloss"
            />
            <span className="text-[11.5px] text-muted">R</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div className="flex flex-col gap-1.5">
          <table className="num w-full border-collapse text-[12px]" data-testid="opt-targets">
            <thead>
              <tr className="text-[11px] text-muted">
                <th className="border-b border-line py-1 text-left font-medium">Wyjście</th>
                <th className="border-b border-line py-1 pl-2 text-right font-medium">Szansa</th>
                <th className="border-b border-line py-1 pl-2 text-right font-medium" title="Oczekiwany wynik 1 lota trzymanego do tego celu (bez celu – na SL): p·(cel + SL) − SL">
                  Oczekiwany / 1 lot
                </th>
                <th className="border-b border-line py-1 pl-2 text-right font-medium" title="Szansa, od której cel daje więcej niż zamknięcie teraz: (teraz + SL) / (cel + SL)">
                  Próg szansy
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-line/60 py-1 font-sans">teraz {pipsText(input.nowPips)}</td>
                <td className="border-b border-line/60 py-1 pl-2 text-right">pewne</td>
                <td className={cx('border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap', toneClass[tone(out.nowPerLot)])}>{money(out.nowPerLot)}</td>
                <td className="border-b border-line/60 py-1 pl-2 text-right text-dim">—</td>
              </tr>
              {out.targets.map((t, k) => (
                <tr key={t.pips} data-testid={`opt-target-${k + 1}`}>
                  <td className="border-b border-line/60 py-1 font-sans">cel {pipsText(t.pips)}</td>
                  <td className="border-b border-line/60 py-1 pl-2 text-right">{pct(t.probability)}</td>
                  <td className={cx('border-b border-line/60 py-1 pl-2 text-right whitespace-nowrap', toneClass[tone(t.evPerLot)])}>{money(t.evPerLot)}</td>
                  <td className={cx('border-b border-line/60 py-1 pl-2 text-right', t.breakEven != null && t.probability > t.breakEven ? 'text-fg-strong' : 'text-muted')}>
                    {t.breakEven == null ? 'nigdy' : pct(t.breakEven)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {out.targets.length === 0 && <span className="text-[11.5px] text-muted">Dodaj cele (część „Cel” z szansą) – optymalizacja wybiera spośród nich i zamknięcia teraz.</span>}
          <span className="text-[11px] text-dim">
            Cel daje więcej niż zamknięcie teraz, gdy jego szansa przekracza próg (pogrubiony = przekracza). Bez SL na BE najwyższy oczekiwany wynik daje zawsze
            jedno wyjście – partiale go nie podnoszą, tylko zmniejszają ryzyko.
          </span>
        </div>
        <div className="flex flex-col gap-1.5 text-[12px]">
          {!out.ok ? (
            <p className="text-accent" data-testid="opt-error">
              {out.error}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-0.5 border border-accent/60 bg-accent-soft px-2.5 py-2" data-testid="opt-result">
                {out.split.parts.map((p, k) => (
                  <span key={k} className="num text-[13px] text-fg-strong" data-testid={`opt-part-${k + 1}`}>
                    {Number(p.percent.toFixed(2))}% ({p.lots.toFixed(lotDec)} lota) {p.mode === 'now' ? `teraz ${pipsText(p.pips)}` : `na ${pipsText(p.pips)} (szansa ${pct(p.probability)})`}
                  </span>
                ))}
              </div>
              <span>
                oczekiwany{' '}
                <b className={cx('num font-medium', toneClass[tone(out.split.expected)])} data-testid="opt-expected">
                  {money(out.split.expected)}
                </b>{' '}
                <span className="num text-muted">({fmtR(out.split.expectedR)})</span>
                {' · '}najgorszy możliwy{' '}
                <b className={cx('num font-medium', toneClass[tone(out.split.worst)])} data-testid="opt-worst">
                  {money(out.split.worst)}
                </b>{' '}
                <span className="num text-muted">({fmtR(out.split.worstR)})</span>
              </span>
              {out.split.final && (
                <span data-testid="opt-final-cost">
                  {out.split.final.cost < 0.005 ? (
                    `Bez kosztu względem całości na ${pipsText(out.split.final.pips)} – cała pozycja zamyka się na ostatnim celu.`
                  ) : (
                    <>
                      Koszt partiali względem całości na {pipsText(out.split.final.pips)}:{' '}
                      <b className="num font-medium text-down">{abs(out.split.final.cost)}</b>{' '}
                      <span className="num text-muted">({fmtR(out.split.final.costR).replace(/^[+−-]/, '')})</span> – gdy cena tam dojdzie (cała pozycja:{' '}
                      <span className="num">{money(out.split.final.amount)}</span>).
                    </>
                  )}
                </span>
              )}
              <span className="text-muted" data-testid="opt-compare">
                {Math.abs(out.split.vsNow) < 0.005 ? 'Tyle samo co zamknięcie całości teraz' : `O ${abs(out.split.vsNow)} ${out.split.vsNow > 0 ? 'więcej' : 'mniej'} niż zamknięcie całości teraz`}
                {currentExpected != null &&
                  (Math.abs(out.split.expected - currentExpected) < 0.005
                    ? '; tyle samo co Twój podział.'
                    : `; o ${abs(out.split.expected - currentExpected)} ${out.split.expected > currentExpected ? 'więcej' : 'mniej'} niż Twój podział.`)}
              </span>
              <button className="btn btn-accent self-start" onClick={() => set({ parts: out.split.specs })} data-testid="opt-apply">
                Zastosuj ten podział
              </button>
              {input.breakevenAfterFirst && (
                <span className="text-[11px] text-dim">
                  Z SL na BE model premiuje mały pierwszy partial (odblokowuje BE dla reszty). Szanse dalszych celów wpisz takie, jakie są przy SL na BE – zwykle
                  niższe.
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The whole position held to the final target: what the partials give up there, and the expected results. */
function FinalTarget({ final, money }: { final: NonNullable<Plan['final']>; money: (v: number) => string }) {
  const abs = (v: number) => money(Math.abs(v)).replace(/^[+−-]/, '')
  const rAbs = (v: number) => fmtR(Math.abs(v)).replace(/^[+−-]/, '')
  const vs = Math.abs(final.splitVsHold) < 0.005 ? 'tyle samo' : final.splitVsHold > 0 ? `o ${abs(final.splitVsHold)} więcej` : `o ${abs(final.splitVsHold)} mniej`
  return (
    <div className="flex flex-col gap-1 border border-line px-2.5 py-2 text-[12px]" data-testid="part-final">
      <span className="label">Całość na ostatnim celu ({pipsText(final.pips)})</span>
      <span>
        Gdyby cała pozycja doszła do {pipsText(final.pips)}:{' '}
        <b className={cx('num font-medium', toneClass[tone(final.amount)])} data-testid="part-final-amount">
          {money(final.amount)}
        </b>{' '}
        <span className="num text-muted">({fmtR(final.r)})</span>
      </span>
      <span data-testid="part-final-cost">
        {final.cost < 0.005 ? (
          'Partiale nic tu nie kosztują – cała pozycja zamyka się na ostatnim celu.'
        ) : (
          <>
            Na partialach tracisz wtedy{' '}
            <b className="num font-medium text-down">{abs(final.cost)}</b> <span className="num text-muted">({rAbs(final.costR)})</span> – tyle kosztuje
            wcześniejsze zamknięcie części pozycji.
          </>
        )}
      </span>
      <span className="text-muted" data-testid="part-final-expected">
        Przy szansie {chanceText(final.probability)} na {pipsText(final.pips)} trzymanie całości daje oczekiwany wynik{' '}
        <span className={cx('num', toneClass[tone(final.expected)])}>{money(final.expected)}</span> ({fmtR(final.expectedR)}; bez celu cała pozycja na SL) –
        podział oczekiwany daje {vs}.
      </span>
    </div>
  )
}

function chanceText(p: number): string {
  return `${Number((p * 100).toFixed(1))}%`
}

type Plan = NonNullable<Extract<ReturnType<typeof partialPlan>, { ok: true }>['plan']>

/** "2 partiale", "3 partiale", "4 partiale"; one part at a target = holding the whole position to it. */
function splitName(plan: Plan): string {
  const n = plan.rows.length
  if (n === 1) return `trzymanie całości do celu ${pipsText(plan.rows[0]!.pips)}`
  return `podział na ${n} partiale (${plan.rows.map((r) => `${Number(r.percent.toFixed(2))}% ${r.mode === 'now' ? 'teraz' : pipsText(r.pips)}`).join(', ')})`
}

/** The more profitable choice by the expected result. */
function suggestion(plan: Plan, money: (v: number) => string): string {
  const now = `zamknięcie całości teraz na ${pipsText(plan.closeNow.pips)} (${money(plan.closeNow.amount)})`
  const exp = `${money(plan.expected.amount)}, ${fmtR(plan.expected.r)}`
  const diff = money(Math.abs(plan.expected.vsNow)).replace(/^[+−-]/, '')
  if (!plan.rows.some((r) => r.mode === 'target')) return `Oba warianty dają tyle samo: wszystkie części zamykasz teraz (${money(plan.closeNow.amount)}).`
  if (plan.suggestion === 'equal') return `Oba warianty dają tyle samo: ${splitName(plan)} – oczekiwany wynik ${exp} – i ${now}.`
  if (plan.suggestion === 'split') return `Bardziej opłacalny: ${splitName(plan)} – oczekiwany wynik ${exp}, o ${diff} więcej niż ${now}.`
  return `Bardziej opłacalne: ${now} – ${splitName(plan)} daje oczekiwany wynik ${exp}, o ${diff} mniej.`
}

function suggestionNote(plan: Plan): string | null {
  const targets = plan.rows.filter((r) => r.mode === 'target')
  const lowered = targets.filter((r) => r.probabilityLowered)
  if (lowered.length)
    return `* Szansa części ${lowered.map((r) => r.n).join(', ')} obniżona do szansy bliższego celu – żeby dojść dalej, cena musi przejść przez bliższy cel.`
  if (targets.length && targets.every((r) => r.probability >= 1 - 1e-9))
    return 'Przy szansie 100% przy każdym celu oczekiwany wynik = wszystkie cele osiągnięte. Wpisz realną szansę przy celach, żeby porównanie uwzględniało ryzyko powrotu ceny.'
  return null
}

function verdict(plan: Plan, money: (v: number) => string): string {
  const targets = plan.rows.filter((r) => r.mode === 'target').map((r) => r.pips).sort((a, b) => a - b)
  if (!targets.length) return 'Wszystkie części zamykasz teraz – wynik jest taki sam jak przy zamknięciu całości.'
  const k = plan.beatsNowAfter
  const loss = plan.worst.vsNow < 0 ? ` Jeśli cena wróci przed pierwszym celem, wyjdziesz o ${money(-plan.worst.vsNow).replace(/^\+/, '')} gorzej niż przy zamknięciu teraz.` : ''
  if (k == null) return `Podział nie daje więcej niż zamknięcie teraz.${loss}`
  if (k === 0) return `Podział daje co najmniej tyle, co zamknięcie teraz, nawet gdy cena wróci od razu.`
  const more = plan.scenarios[k]!.vsNow > 0.005 ? 'więcej niż' : 'tyle samo, co'
  return `Podział daje ${more} zamknięcie teraz, jeśli cena dojdzie do ${k === targets.length && k > 1 ? 'ostatniego celu' : `celu ${pipsText(targets[k - 1]!)}`}.${loss}`
}
