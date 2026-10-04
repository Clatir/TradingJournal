import { create } from 'zustand'
import type { RecordEntry } from '@shared/api'
import type { MonteCarloSummary } from '@shared/calc/montecarlo'
import type { Forecast } from '@shared/schema'

/** Result of "Policz rozrzut" for one scenario; `key` tells whether the scenario changed since. */
export interface SpreadResult {
  scenarioId: string
  key: string
  summary: MonteCarloSummary
}

/** Page state kept only for the session (never written to files, chapter 4.3). */
interface ForecastSession {
  /** Scenario opened last. */
  lastId: string | null
  /** Scenario to compare with. */
  compareId: string | null
  /** Collapsed years of the month table ("2027" → true). */
  collapsed: Record<string, true>
  chartScale: 'linear' | 'log'
  /** Results of many runs, by scenario id. */
  spread: Record<string, SpreadResult>
  /** "Pokaż rozrzut" on the chart. */
  showSpread: boolean
}

export const useForecastSession = create<ForecastSession>(() => ({
  lastId: null,
  compareId: null,
  collapsed: {},
  chartScale: 'linear',
  spread: {},
  showSpread: true
}))

/** Scenarios sorted by name (Polish collation). */
export function sortedScenarios(map: Record<string, RecordEntry<Forecast>>): Forecast[] {
  return Object.values(map)
    .map((e) => e.record)
    .sort((a, b) => a.name.localeCompare(b.name, 'pl') || a.id.localeCompare(b.id))
}

/** Scenario to show: the one in the route, the last opened one, else the first by name. */
export function pickScenario(map: Record<string, RecordEntry<Forecast>>, routeId: string | undefined, lastId: string | null): Forecast | null {
  if (routeId && map[routeId]) return map[routeId].record
  if (lastId && map[lastId]) return map[lastId].record
  return sortedScenarios(map)[0] ?? null
}
