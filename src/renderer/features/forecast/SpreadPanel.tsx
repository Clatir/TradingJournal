import { useEffect, useRef, useState } from 'react'
import type { ForecastInput } from '@shared/calc/forecast'
import { hasRandomness, runMonteCarlo, startMonteCarlo, summarizeMonteCarlo, type Spread } from '@shared/calc/montecarlo'
import { goalName } from '@shared/export/forecast'
import type { Forecast } from '@shared/schema'
import { fmtAmount, fmtPct } from '../../lib/format'
import { Badge, Panel, Segmented } from '../../components/ui'
import { updateScenario } from './actions'
import { useForecastSession } from './session'

const CHUNK = 100
const RUN_OPTIONS = [200, 1000, 5000] as const

/**
 * Identity of the calculation: a changed scenario (including the number of runs) makes an earlier result "nieaktualny".
 * The stored draws do not matter here.
 */
export function spreadKey(input: ForecastInput, runs: number): string {
  return JSON.stringify({ ...input, draws: null, runs })
}

/** "Rozrzut wyników" (chapter 11): many runs with fresh random numbers, computed in chunks. */
export function SpreadPanel({ scenario, input }: { scenario: Forecast; input: ForecastInput | null }) {
  const stored = useForecastSession((s) => s.spread[scenario.id] ?? null)
  const [progress, setProgress] = useState<number | null>(null)
  const token = useRef(0)
  const runs = scenario.monteCarloRuns
  const key = input ? spreadKey(input, runs) : ''
  const random = input ? hasRandomness(input) : false

  // A change of the scenario (or leaving it) stops a calculation in progress.
  useEffect(() => {
    token.current++
    setProgress(null)
  }, [scenario.id, key])
  useEffect(() => () => void token.current++, [])

  const start = () => {
    if (!input || !random) return
    const my = ++token.current
    const state = startMonteCarlo(input)
    setProgress(0)
    const step = () => {
      if (token.current !== my) return
      runMonteCarlo(state, Math.min(CHUNK, runs - state.runs))
      if (state.runs < runs) {
        setProgress(state.runs / runs)
        setTimeout(step, 0)
        return
      }
      setProgress(null)
      useForecastSession.setState((s) => ({ spread: { ...s.spread, [scenario.id]: { scenarioId: scenario.id, key, summary: summarizeMonteCarlo(state) } } }))
    }
    setTimeout(step, 0)
  }

  const fund = scenario.keep === 'fund'
  const cur = scenario.currency
  const summary = stored?.summary ?? null
  const stale = !!stored && stored.key !== key
  const row = (label: string, s: Spread, testId: string) => (
    <tr data-testid={testId}>
      <td className="border-b border-line/60 py-1 font-sans text-muted">{label}</td>
      <td className="border-b border-line/60 py-1 text-right">{fmtAmount(s.p5, cur)}</td>
      <td className="border-b border-line/60 py-1 text-right text-fg-strong">{fmtAmount(s.p50, cur)}</td>
      <td className="border-b border-line/60 py-1 text-right">{fmtAmount(s.p95, cur)}</td>
    </tr>
  )

  return (
    <Panel title="Rozrzut wyników">
      <div className="flex flex-col gap-2.5" data-testid="fc-spread">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-muted">Liczba przebiegów</span>
          <Segmented
            value={(RUN_OPTIONS as readonly number[]).includes(runs) ? (String(runs) as `${(typeof RUN_OPTIONS)[number]}`) : null}
            options={RUN_OPTIONS.map((n) => ({ value: String(n) as `${typeof n}`, label: String(n), disabled: progress != null }))}
            onChange={(v) => updateScenario(scenario.id, (f) => ({ ...f, monteCarloRuns: Number(v) }))}
            size="sm"
            aria-label="Liczba przebiegów"
          />
          <button className="btn btn-accent" disabled={!random || progress != null} onClick={start} data-testid="fc-mc-run">
            Policz rozrzut
          </button>
          {progress != null && (
            <span className="flex items-center gap-2" data-testid="fc-mc-progress">
              <span className="relative h-[6px] w-[160px] border border-line-strong">
                <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
              <span className="num text-[11.5px] text-muted">{Math.round(progress * 100)}%</span>
            </span>
          )}
          {stale && progress == null && (
            <span data-testid="fc-mc-stale">
              <Badge tone="warn">nieaktualny — policz ponownie</Badge>
            </span>
          )}
        </div>
        {!input && <p className="text-[12px] text-muted">Rozrzut będzie dostępny, gdy prognozę da się policzyć – czego brakuje, pokazuje panel „Zysk i kapitał”.</p>}
        {input && !random && <p className="text-[12px] text-muted">Ten scenariusz nie ma losowości, więc każdy przebieg jest taki sam.</p>}
        {random && !summary && progress == null && (
          <p className="text-[11.5px] text-muted">
            Każdy przebieg dostaje świeżo wylosowane liczby (zwroty, pipsy, miesiące stratne); tabela pokazuje, jak bardzo mogą się różnić wyniki tego samego scenariusza.
          </p>
        )}
        {summary && (
          <div className={stale ? 'opacity-60' : undefined}>
            <table className="num w-full border-collapse text-[12px]" data-testid="fc-mc-table">
              <thead>
                <tr className="text-[11px] text-muted">
                  <th className="border-b border-line py-1 text-left font-medium">{summary.runs} przebiegów</th>
                  <th className="border-b border-line py-1 text-right font-medium">Pesymistyczny (5%)</th>
                  <th className="border-b border-line py-1 text-right font-medium">Typowy (50%)</th>
                  <th className="border-b border-line py-1 text-right font-medium">Optymistyczny (95%)</th>
                </tr>
              </thead>
              <tbody>
                {row(fund ? 'Masa obrotowa na koniec' : 'Kapitał na koniec', summary.end, 'fc-mc-end')}
                {row(fund ? 'Odłożone z zysku' : 'Suma wypłat', summary.payout, 'fc-mc-payout')}
                {row('Na cele zakupowe', summary.spent, 'fc-mc-spent')}
                {row(fund ? 'Fundusz celowy na koniec' : 'Odłożona gotówka na koniec', summary.pot, 'fc-mc-pot')}
              </tbody>
            </table>
            <p className="mt-2 text-[12px]" data-testid="fc-mc-below">
              Szansa, że na koniec masz mniej kapitału, niż wpłaciłeś: <b className="num text-fg-strong">{fmtPct(summary.belowPaidInPct, 1)}</b>
            </p>
            {summary.goals.length > 0 && (
              <table className="num mt-2 w-full border-collapse text-[12px]" data-testid="fc-mc-goals">
                <thead>
                  <tr className="text-[11px] text-muted">
                    <th className="border-b border-line py-1 text-left font-medium">Cel</th>
                    <th className="border-b border-line py-1 text-right font-medium">Kupiony</th>
                    <th className="border-b border-line py-1 text-right font-medium">Typowy miesiąc</th>
                    <th className="border-b border-line py-1 text-right font-medium">Zakres 5–95%</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.goals.map((g) => (
                    <tr key={g.id}>
                      <td className="border-b border-line/60 py-1 font-sans">{goalName(g.name)}</td>
                      <td className="border-b border-line/60 py-1 text-right">w {fmtPct(g.boughtPct, 0)} przebiegów</td>
                      <td className="border-b border-line/60 py-1 text-right">{g.typicalMonth != null ? `mies. ${g.typicalMonth}` : '—'}</td>
                      <td className="border-b border-line/60 py-1 text-right">{g.monthRange ? `${g.monthRange[0]}–${g.monthRange[1]}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
