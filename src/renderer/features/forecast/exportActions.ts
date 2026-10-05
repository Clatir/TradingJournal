import type { ForecastInput, ForecastResult } from '@shared/calc/forecast'
import { forecastCsv, forecastTable, forecastWorkbook } from '@shared/export/forecast'
import type { PipValue } from '@shared/instruments'
import { slugLabel } from '@shared/paths'
import type { Forecast, Instrument } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { toast } from '../../store/ui'
import { goalStatus, scenarioSettingsRows } from './texts'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "prognoza-<slug nazwy>-<RRRR-MM-DD>.<ext>" */
export const exportName = (scenario: Forecast, ext: string) => `prognoza-${slugLabel(scenario.name, 'scenariusz').toLowerCase()}-${today()}.${ext}`

export async function exportForecastCsv(scenario: Forecast, input: ForecastInput, result: ForecastResult): Promise<void> {
  try {
    const path = await api.saveTextFile(exportName(scenario, 'csv'), forecastCsv(forecastTable(result, scenario, input)), { name: 'CSV', extensions: ['csv'] })
    if (path) toast(`Zapisano ${path}`, 'success', 4000)
  } catch (e) {
    toast(errorMessage(e), 'error', 6000)
  }
}

export async function exportForecastXlsx(args: {
  scenario: Forecast
  input: ForecastInput
  result: ForecastResult
  cash: ForecastResult | null
  instrument: Instrument | null
  pip: PipValue | null
}): Promise<void> {
  const { scenario, input, result, cash } = args
  const sheets = forecastWorkbook({
    sim: result,
    scenario,
    input,
    settings: scenarioSettingsRows(scenario, { input, instrumentName: args.instrument?.name ?? null, pip: args.pip, exportedAt: new Date() }),
    goalState: (goal) => goalStatus(goal, { scenario, input, result, cash }).parts.map((p) => p.text).join('').replace(/ /g, ' ')
  })
  try {
    const path = await api.saveXlsx(exportName(scenario, 'xlsx'), sheets)
    if (path) toast(`Zapisano ${path}`, 'success', 4000)
  } catch (e) {
    toast(errorMessage(e), 'error', 6000)
  }
}
