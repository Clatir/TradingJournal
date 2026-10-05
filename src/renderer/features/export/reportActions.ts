import type { RecordEntry } from '@shared/api'
import { buildMonthlyReport, monthlyReportHtml, monthlyReportMarkdown, reportMonths, type MonthlyReport } from '@shared/export/monthlyReport'
import type { Trade } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { computeRows } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { toast } from '../../store/ui'

/** Trades the user kept (untouched drafts exist only in memory). */
function keptTrades(): Record<string, RecordEntry<Trade>> {
  const { trades, drafts } = useJournal.getState()
  if (!Object.keys(drafts).length) return trades
  return Object.fromEntries(Object.entries(trades).filter(([id]) => !drafts[id]))
}

/** Report of a month (YYYY-MM) from the whole journal (all pairs). */
export function monthlyReport(month: string): MonthlyReport | null {
  const { days, journal } = useJournal.getState()
  if (!journal) return null
  const rows = computeRows(keptTrades(), days, journal.settings)
  return buildMonthlyReport(
    rows,
    Object.values(days).map((e) => e.record),
    journal,
    month
  )
}

/** The newest month with trades, else the current one. */
export function latestReportMonth(): string {
  const { days, journal } = useJournal.getState()
  const rows = journal ? computeRows(keptTrades(), days, journal.settings) : []
  return reportMonths(rows)[0] ?? new Date().toISOString().slice(0, 7)
}

export type ReportOutput = 'copy' | 'md' | 'pdf'

export async function deliverMonthlyReport(month: string, output: ReportOutput): Promise<void> {
  const report = monthlyReport(month)
  if (!report) return
  const name = `raport_${month}`
  try {
    if (output === 'copy') {
      await api.copyText(monthlyReportMarkdown(report))
      toast('Raport (markdown) skopiowany do schowka.', 'success')
      return
    }
    const path =
      output === 'md'
        ? await api.saveTextFile(`${name}.md`, monthlyReportMarkdown(report), { name: 'Markdown', extensions: ['md'] })
        : await api.savePdf(`${name}.pdf`, monthlyReportHtml(report))
    if (path) toast(`Zapisano ${path}`, 'success', 5000)
  } catch (e) {
    toast(errorMessage(e), 'error')
  }
}
