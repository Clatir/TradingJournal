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
import { ScenarioBar } from './ScenarioBar'
import { ComparePanel } from './ComparePanel'
import { ForecastChart } from './ForecastChart'
import { SpreadPanel, spreadKey } from './SpreadPanel'

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
  const folderReadOnly = useJournal((s) => s.status?.readOnly ?? false)
  const lastId = useForecastSession((s) => s.lastId)
  const compareId = useForecastSession((s) => s.compareId)
  const spreadMap = useForecastSession((s) => s.spread)
  const scenario = pickScenario(forecasts, id, lastId)
  const scenarioId = scenario?.id ?? null
  const fileReadOnly = scenarioId ? (forecasts[scenarioId]?.readOnly ?? false) : false
  const readOnly = folderReadOnly || fileReadOnly
  const other = compareId && compareId !== scenarioId ? (forecasts[compareId]?.record ?? null) : null

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
  const otherComputed = useMemo(() => (other && settings ? computeForecast(other, settings) : null), [other, settings])
  const compareLine = useMemo(() => (other && otherComputed?.result ? { scenario: other, result: otherComputed.result } : null), [other, otherComputed])
  const spreadResult = scenarioId ? (spreadMap[scenarioId] ?? null) : null

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
            <button className="btn btn-accent" disabled={folderReadOnly} onClick={() => createScenario()} data-testid="fc-create-first">
              Utwórz pierwszy scenariusz
            </button>
            {folderReadOnly && <span className="text-[11.5px] text-accent">Folder jest tylko do odczytu.</span>}
          </div>
        </Empty>
      </div>
    )

  const { outcome, result, cash } = computed
  const input = outcome.ok ? outcome.input : null
  return (
    <div className="h-full overflow-y-auto px-3 pb-3" data-testid="forecast">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3">
        <ScenarioBar key={scenario.id} scenario={scenario} readOnly={readOnly} fileReadOnly={fileReadOnly} folderReadOnly={folderReadOnly} />
        <PayoutBar scenario={scenario} readOnly={readOnly} />
        <div className="grid grid-cols-1 items-start gap-3 min-[1100px]:grid-cols-2">
          <GainPanel scenario={scenario} settings={settings} outcome={outcome} readOnly={readOnly} />
          <GoalsPanel scenario={scenario} input={input ?? fallbackInput(scenario)} result={result} cash={cash} readOnly={readOnly} />
        </div>
        <SummaryPanel scenario={scenario} input={input} result={result} cash={cash} />
        {other && otherComputed && <ComparePanel scenario={scenario} computed={computed} other={other} otherComputed={otherComputed} />}
        {input && result && (
          <ForecastChart
            scenario={scenario}
            result={result}
            spread={spreadResult && spreadResult.key === spreadKey(input, scenario.monteCarloRuns) ? spreadResult.summary : null}
            compare={compareLine}
          />
        )}
        <SpreadPanel scenario={scenario} input={input} />
        {input && result ? (
          <MonthTable
            scenario={scenario}
            input={input}
            result={result}
            cash={cash}
            instrument={outcome.ok ? outcome.instrument : null}
            pip={outcome.ok ? outcome.pip : null}
            readOnly={readOnly}
          />
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
