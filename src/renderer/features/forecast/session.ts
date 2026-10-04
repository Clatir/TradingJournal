import { create } from 'zustand'
import type { RecordEntry } from '@shared/api'
import type { Forecast } from '@shared/schema'

/** Page state kept only for the session (never written to files, chapter 4.3). */
interface ForecastSession {
  /** Scenario opened last. */
  lastId: string | null
  /** Scenario to compare with. */
  compareId: string | null
  /** Collapsed years of the month table ("2027" → true). */
  collapsed: Record<string, true>
  chartScale: 'linear' | 'log'
}

export const useForecastSession = create<ForecastSession>(() => ({ lastId: null, compareId: null, collapsed: {}, chartScale: 'linear' }))

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
