import { createForecast, freshForecastDraws } from '@shared/defaults'
import type { Forecast } from '@shared/schema'
import { addRecord, updateRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'
import { useForecastSession } from './session'

export function updateScenario(id: string, fn: (f: Forecast) => Forecast): void {
  updateRecord('forecasts', id, fn)
}

/** New scenario as a draft (written on the first change), opened right away. */
export function createScenario(): string | null {
  const { journal, forecasts, status } = useJournal.getState()
  if (!journal || status?.readOnly) return null
  const f = createForecast(journal.settings.risk, Object.values(forecasts).map((e) => e.record.name))
  addRecord('forecasts', f, { draft: true })
  useForecastSession.setState({ lastId: f.id })
  navigate({ page: 'forecast', id: f.id })
  return f.id
}

/** "Losuj ponownie": four new tables of random numbers. */
export function rerollDraws(id: string): void {
  updateScenario(id, (f) => ({ ...f, draws: freshForecastDraws() }))
  toast('Wylosowano nowy scenariusz.', 'success')
}
