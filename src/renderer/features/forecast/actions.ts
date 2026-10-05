import { createForecast, freshForecastDraws } from '@shared/defaults'
import { duplicateForecast } from '@shared/duplicate'
import type { Forecast } from '@shared/schema'
import { addRecord, deleteRecord, updateRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'
import { useForecastSession } from './session'

export function updateScenario(id: string, fn: (f: Forecast) => Forecast): void {
  updateRecord('forecasts', id, fn)
}

/** New scenario as a draft (written on the first change), opened right away. */
export function createScenario(): string | null {
  const { journal, forecasts, drafts, status } = useJournal.getState()
  if (!journal || status?.readOnly) return null
  // An untouched draft is discarded when another scenario opens, so its name stays free.
  const taken = Object.values(forecasts)
    .filter((e) => !drafts[e.record.id])
    .map((e) => e.record.name)
  const f = createForecast(journal.settings.risk, taken)
  addRecord('forecasts', f, { draft: true })
  useForecastSession.setState({ lastId: f.id })
  navigate({ page: 'forecast', id: f.id })
  return f.id
}

/** "Losuj ponownie": four new tables of random numbers. */
export function rerollDraws(id: string): void {
  const { forecasts, status } = useJournal.getState()
  if (status?.readOnly || forecasts[id]?.readOnly) {
    toast(status?.readOnly ? (status.readOnlyReason ?? 'Folder danych jest tylko do odczytu.') : 'Ten scenariusz zapisała nowsza wersja aplikacji – zmiany nie są przyjmowane.', 'error', 5000)
    return
  }
  updateScenario(id, (f) => ({ ...f, draws: freshForecastDraws() }))
  toast('Wylosowano nowy scenariusz.', 'success')
}

/** Ctrl+Shift+D / "Duplikuj": a saved copy with a "(kopia)" name and the same random numbers, opened right away. */
export function duplicateScenario(id: string): string | null {
  const { forecasts, drafts, status } = useJournal.getState()
  const entry = forecasts[id]
  if (!entry) return null
  if (status?.readOnly || entry.readOnly) {
    toast(status?.readOnly ? (status.readOnlyReason ?? 'Folder danych jest tylko do odczytu.') : 'Ten scenariusz zapisała nowsza wersja aplikacji – zaktualizuj aplikację, żeby go skopiować.', 'error', 5000)
    return null
  }
  // An untouched new scenario is saved first, so both stay.
  if (drafts[id]) updateRecord('forecasts', id, (f) => ({ ...f }))
  const copy = duplicateForecast(entry.record, Object.values(forecasts).map((e) => e.record.name), new Date().toISOString())
  addRecord('forecasts', copy)
  useForecastSession.setState({ lastId: copy.id })
  navigate({ page: 'forecast', id: copy.id })
  toast(`Utworzono kopię: „${copy.name}”.`, 'success')
  return copy.id
}

/** Delete a scenario (its file goes to the recycle bin); the page shows the first remaining one. */
export async function deleteScenario(id: string): Promise<void> {
  const s = useForecastSession.getState()
  useForecastSession.setState({ lastId: s.lastId === id ? null : s.lastId, compareId: s.compareId === id ? null : s.compareId })
  navigate({ page: 'forecast' })
  await deleteRecord('forecasts', id)
}

/** The scenario shown on the forecast page (route, last opened, first by name). */
export function currentScenarioId(routeId: string | undefined): string | null {
  const { forecasts } = useJournal.getState()
  if (routeId && forecasts[routeId]) return routeId
  const last = useForecastSession.getState().lastId
  if (last && forecasts[last]) return last
  return Object.values(forecasts).map((e) => e.record).sort((a, b) => a.name.localeCompare(b.name, 'pl') || a.id.localeCompare(b.id))[0]?.id ?? null
}
