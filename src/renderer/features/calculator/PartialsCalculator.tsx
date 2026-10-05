import { useEffect } from 'react'
import { create } from 'zustand'
import { MAX_PARTIALS, partialPercents, partialPlan, type PartialSpec, type PlanScenario } from '@shared/calc/partials'
import { lotDecimals, shownDecimals } from '@shared/calc/position'
import { findInstrument, instrumentPipValue, missingPipValue, selectableInstruments } from '@shared/instruments'
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
}

/** Kept for the session, so leaving the screen does not reset the comparison. */
const usePartials = create<PartialsInputs>(() => ({
  instrument: 'EURUSD',
  lots: 1,
  stopPips: 20,
  nowPips: 30,
  breakeven: false,
  parts: [
    { mode: 'now', percent: 50, targetPips: null },
    { mode: 'target', percent: null, targetPips: 60 }
  ]
}))
const set = (patch: Partial<PartialsInputs>) => usePartials.setState(patch)
const setPart = (k: number, patch: Partial<PartialSpec>) => usePartials.setState((s) => ({ parts: s.parts.map((p, i) => (i === k ? { ...p, ...patch } : p)) }))

const SEGMENTED_MAX = 6
const pipsText = (p: number) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} pips`

/**
 * "Partiale": close the whole open position now, or split it into up to 4 parts (now or at targets). Shows the
 * result of every choice: closing now, each part, and every outcome of the split (0, 1, … targets reached).
 */
export function PartialsCalculator({ settings, from }: { settings: Settings; from?: { key: string; instrument: string | null; lots: number | null; stopPips: number | null } }) {
  const { instrument: selectedId, lots, stopPips, nowPips, breakeven, parts } = usePartials()
  const account = settings.risk.accountCurrency

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
      return { parts: [...prev, { mode: 'target', percent: null, targetPips: Math.round(lastTarget + (s.stopPips ?? 20)) }] }
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
                  <span className="w-[52px] text-[11.5px] text-muted">Część {k + 1}</span>
                  <Segmented
                    value={p.mode}
                    options={[
                      { value: 'now', label: 'Teraz' },
                      { value: 'target', label: 'Cel' }
                    ]}
                    onChange={(mode) => setPart(k, { mode, targetPips: mode === 'target' ? (p.targetPips ?? Math.round((nowPips ?? 0) + (stopPips ?? 20))) : p.targetPips })}
                    size="sm"
                    aria-label={`Część ${k + 1}`}
                  />
                  {last ? (
                    <span className="num w-[86px] text-right text-[12px] text-muted" data-testid={`part-${k + 1}-pct`}>
                      {parts.length === 1 ? 'całość' : `reszta ${Number(percents[k]!.toFixed(2))}%`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <NumberField
                        value={p.percent}
                        onChange={(v) => setPart(k, { percent: v != null && v > 0 && v < 100 ? v : null })}
                        decimals={shownDecimals(p.percent, 0)}
                        step={5}
                        className="w-[64px]"
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
                        className="w-[72px]"
                        aria-label={`Cel części ${k + 1} w pipsach`}
                        data-testid={`part-${k + 1}-target`}
                      />
                      <span className="text-[11.5px] text-muted">pips</span>
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
                </div>
              </div>

              <table className="num w-full border-collapse text-[12px]" data-testid="part-rows">
                <thead>
                  <tr className="text-[11px] text-muted">
                    <th className="border-b border-line py-1 text-left font-medium">Część</th>
                    <th className="border-b border-line py-1 text-right font-medium">Loty</th>
                    <th className="border-b border-line py-1 text-right font-medium">Zamknięcie</th>
                    <th className="border-b border-line py-1 text-right font-medium">Wynik części</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={row.n} data-testid={`part-row-${row.n}`}>
                      <td className="border-b border-line/60 py-1 font-sans">
                        {row.n} <span className="text-dim">({Number(row.percent.toFixed(2))}%)</span>
                      </td>
                      <td className="border-b border-line/60 py-1 text-right">{row.lots.toFixed(lotDec)}</td>
                      <td className="border-b border-line/60 py-1 text-right">{row.mode === 'now' ? `teraz ${pipsText(row.pips)}` : `cel ${pipsText(row.pips)}`}</td>
                      <td className={cx('border-b border-line/60 py-1 text-right whitespace-nowrap', valueClass(row.amount))}>
                        {money(row.amount)} <span className="text-dim">{fmtR(row.r)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <table className="num w-full border-collapse text-[12px]" data-testid="part-scenarios">
                <thead>
                  <tr className="text-[11px] text-muted">
                    <th className="border-b border-line py-1 text-left font-medium">Gdy</th>
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
      </div>
    </Panel>
  )
}

function verdict(plan: NonNullable<Extract<ReturnType<typeof partialPlan>, { ok: true }>['plan']>, money: (v: number) => string): string {
  const targets = plan.rows.filter((r) => r.mode === 'target').map((r) => r.pips).sort((a, b) => a - b)
  if (!targets.length) return 'Wszystkie części zamykasz teraz – wynik jest taki sam jak przy zamknięciu całości.'
  const k = plan.beatsNowAfter
  const loss = plan.worst.vsNow < 0 ? ` Jeśli cena wróci przed pierwszym celem, wyjdziesz o ${money(-plan.worst.vsNow).replace(/^\+/, '')} gorzej niż przy zamknięciu teraz.` : ''
  if (k == null) return `Podział nie daje więcej niż zamknięcie teraz.${loss}`
  if (k === 0) return `Podział daje co najmniej tyle, co zamknięcie teraz, nawet gdy cena wróci od razu.`
  const more = plan.scenarios[k]!.vsNow > 0.005 ? 'więcej niż' : 'tyle samo, co'
  return `Podział daje ${more} zamknięcie teraz, jeśli cena dojdzie do ${k === targets.length && k > 1 ? 'ostatniego celu' : `celu ${pipsText(targets[k - 1]!)}`}.${loss}`
}
