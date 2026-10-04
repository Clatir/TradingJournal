import { useEffect, useMemo } from 'react'
import { simulateForecast, type ForecastResult } from '@shared/calc/forecast'
import { firstMonthParts, forecastInputFrom, type ForecastInputOutcome } from '@shared/forecast-input'
import type { Forecast, Settings } from '@shared/schema'
import { discardDraft, useJournal } from '../../store/journal'
import { Empty } from '../../components/ui'
import { completedDraws } from '@shared/defaults'
import { createScenario, updateScenario } from './actions'
import { pickScenario, useForecastSession } from './session'
import { PayoutBar } from './PayoutBar'
import { GainPanel } from './GainPanel'
import { GoalsPanel } from './GoalsPanel'
import { SummaryPanel } from './SummaryPanel'
import { MonthTable } from './MonthTable'
import { Explanations } from './Explanations'

export interface ForecastComputation {
  outcome: ForecastInputOutcome
  result: ForecastResult | null
  /** The same scenario kept in cash (fund mode only, chapter 5.7). */
  cash: ForecastResult | null
}

/** Scenario → input → result (and the cash run in fund mode). */
export function computeForecast(scenario: Forecast, settings: Settings): ForecastComputation {
  const outcome = forecastInputFrom(scenario, settings)
  if (!outcome.ok) return { outcome, result: null, cash: null }
  const result = simulateForecast(outcome.input)
  const cash = outcome.input.keep === 'fund' ? simulateForecast({ ...outcome.input, keep: 'cash' }) : null
  return { outcome, result, cash }
}

/** "Prognoza wypłat" (chapter 6). */
export function ForecastPage({ id }: { id?: string }) {
  const forecasts = useJournal((s) => s.forecasts)
  const settings = useJournal((s) => s.journal?.settings ?? null)
  const readOnly = useJournal((s) => s.status?.readOnly ?? false)
  const lastId = useForecastSession((s) => s.lastId)
  const scenario = pickScenario(forecasts, id, lastId)
  const scenarioId = scenario?.id ?? null

  useEffect(() => {
    if (scenarioId && scenarioId !== useForecastSession.getState().lastId) useForecastSession.setState({ lastId: scenarioId })
  }, [scenarioId])
  // An untouched new scenario is dropped when the page or the scenario changes (like new trades).
  useEffect(() => () => scenarioId ? discardDraft('forecasts', scenarioId) : undefined, [scenarioId])
  // Draws missing from a hand-edited file are filled in once and saved (chapter 4.2).
  useEffect(() => {
    if (!scenarioId || readOnly) return
    const f = useJournal.getState().forecasts[scenarioId]?.record
    const draws = f ? completedDraws(f.draws) : null
    if (draws) updateScenario(scenarioId, (x) => ({ ...x, draws }))
  }, [scenarioId, readOnly])

  const computed = useMemo(() => (scenario && settings ? computeForecast(scenario, settings) : null), [scenario, settings])

  if (!settings) return null
  if (!scenario || !computed)
    return (
      <div className="h-full" data-testid="forecast">
        <Empty>
          <div className="flex flex-col items-center gap-3" data-testid="fc-empty">
            <div className="text-[14px] text-fg-strong">Prognoza wypłat</div>
            <p className="max-w-[460px] text-[12px]">
              Policz, ile zarobisz i wypłacisz w kolejnych miesiącach, kiedy uzbierasz na cele zakupowe i jak zmieni to fundusz celowy. Scenariusz zapisuje się w folderze
              danych, razem z dziennikiem.
            </p>
            <button className="btn btn-accent" disabled={readOnly} onClick={() => createScenario()} data-testid="fc-create-first">
              Utwórz pierwszy scenariusz
            </button>
            {readOnly && <span className="text-[11.5px] text-accent">Folder jest tylko do odczytu.</span>}
          </div>
        </Empty>
      </div>
    )

  const { outcome, result, cash } = computed
  const input = outcome.ok ? outcome.input : null
  return (
    <div className="h-full overflow-y-auto px-3 pb-3" data-testid="forecast">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3">
        <div className="flex items-center gap-2 pt-3" data-testid="fc-header">
          <h1 className="text-[14px] font-medium text-fg-strong" data-testid="fc-name">
            {scenario.name}
          </h1>
          <span className="num text-[11.5px] text-muted">{scenario.currency}</span>
        </div>
        <PayoutBar scenario={scenario} readOnly={readOnly} />
        <div className="grid grid-cols-1 items-start gap-3 min-[1100px]:grid-cols-2">
          <GainPanel scenario={scenario} settings={settings} outcome={outcome} />
          <GoalsPanel scenario={scenario} input={input ?? fallbackInput(scenario)} result={result} cash={cash} readOnly={readOnly} />
        </div>
        <SummaryPanel scenario={scenario} input={input} result={result} cash={cash} />
        {input && result ? (
          <MonthTable scenario={scenario} input={input} result={result} readOnly={readOnly} />
        ) : (
          <div className="border border-line bg-panel p-3 text-muted" data-testid="fc-table-empty">
            Tabela pojawi się, gdy będzie znana wartość pipsa w walucie scenariusza.
          </div>
        )}
        <Explanations />
      </div>
    </div>
  )
}

/** Labels of goal months without a calculation (pip mode without a rate). */
function fallbackInput(scenario: Forecast): { horizon: number; m0: number; y0: number } {
  return { horizon: scenario.months, ...firstMonthParts(scenario.firstMonth) }
}
