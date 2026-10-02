import { tradesToCsv } from '@shared/export/csv'
import { dayPlanToMarkdown, tradeToMarkdown } from '@shared/export/markdown'
import { tradingDateNy } from '@shared/calc/time'
import { api, errorMessage } from '../../lib/api'
import { useJournal } from '../../store/journal'
import { toast, useUi } from '../../store/ui'

async function deliver(markdown: string, fileName: string, saveFile: boolean): Promise<void> {
  try {
    if (saveFile) {
      const path = await api.saveTextFile(fileName, markdown, { name: 'Markdown', extensions: ['md'] })
      if (path) toast(`Zapisano ${path}`, 'success')
      return
    }
    await api.copyText(markdown)
    toast('Markdown skopiowany do schowka.', 'success')
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}

export async function copyTradeMarkdown(id: string, saveFile = false): Promise<void> {
  const { trades, days, journal } = useJournal.getState()
  const t = trades[id]?.record
  if (!t || !journal) return
  const date = tradingDateNy(t.entryTime)
  const day = Object.values(days).find((e) => e.record.date === date)?.record ?? null
  await deliver(tradeToMarkdown(t, journal, day), `${date}_${t.pair}_${t.direction}.md`, saveFile)
}

export async function copyDayMarkdown(date: string, saveFile = false): Promise<void> {
  const { trades, days, journal } = useJournal.getState()
  const d = Object.values(days).find((e) => e.record.date === date)?.record
  if (!d || !journal) return
  await deliver(dayPlanToMarkdown(d, journal, Object.values(trades).map((e) => e.record)), `plan_${date}.md`, saveFile)
}

/** Ctrl+Shift+M: markdown of the trade or day plan currently on screen. */
export async function copyMarkdownForRoute(): Promise<void> {
  const route = useUi.getState().route
  if (route.page === 'trade') await copyTradeMarkdown(route.id)
  else if (route.page === 'day') await copyDayMarkdown(route.date)
  else toast('Markdown: otwórz transakcję albo plan dnia.')
}

export async function exportCsv(): Promise<void> {
  const { trades, days, journal } = useJournal.getState()
  if (!journal) return
  try {
    const csv = tradesToCsv(
      Object.values(trades).map((e) => e.record),
      journal,
      Object.values(days).map((e) => e.record)
    )
    const path = await api.saveTextFile(`ICT-Journal-transakcje-${new Date().toISOString().slice(0, 10)}.csv`, csv, { name: 'CSV (Excel)', extensions: ['csv'] })
    if (path) toast(`Zapisano ${Object.keys(trades).length} transakcji: ${path}`, 'success', 5000)
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}
