import { useMemo, useState } from 'react'
import { monthRange, quarterRange, rangeLabel, yearRange, type DateRange } from '@shared/calc/periods'
import { buildReport, DEFAULT_REPORT_SECTIONS, REPORT_SECTIONS, reportMonths, reportSections, type ReportSectionId } from '@shared/export/monthlyReport'
import { useTradeRows } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { Panel, Segmented, cx } from '../../components/ui'
import { todayNy } from '../day/DayPlanPage'
import { deliverReport } from '../export/reportActions'

type Kind = 'month' | 'quarter' | 'year' | 'custom'

const SECTIONS_KEY = 'ictj.report.sections'

function loadSections(): ReportSectionId[] {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    const ids = raw ? (JSON.parse(raw) as string[]) : null
    const known = new Set<string>(REPORT_SECTIONS.map((s) => s.id))
    if (Array.isArray(ids)) return ids.filter((id): id is ReportSectionId => known.has(id))
  } catch {
    // Private mode / blocked storage: defaults.
  }
  return [...DEFAULT_REPORT_SECTIONS]
}

function saveSections(ids: readonly ReportSectionId[]): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(ids))
  } catch {
    // Not essential.
  }
}

const QUARTER = ['I', 'II', 'III', 'IV']

/** Reports (Ctrl+9): any period (month, quarter, year, own dates), chosen sections, preview, markdown / PDF. */
export function ReportsPage() {
  const allRows = useTradeRows()
  const journal = useJournal((s) => s.journal)
  const dayEntries = useJournal((s) => s.days)
  const drafts = useJournal((s) => s.drafts)
  const rows = useMemo(() => allRows.filter((r) => !drafts[r.trade.id]), [allRows, drafts])
  const days = useMemo(() => Object.values(dayEntries).map((e) => e.record), [dayEntries])

  const today = todayNy()
  const thisMonth = today.slice(0, 7)
  const months = useMemo(() => [...new Set([thisMonth, ...reportMonths(rows)])].sort().reverse(), [rows, thisMonth])
  const years = useMemo(() => [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => b - a), [months])

  const [kind, setKind] = useState<Kind>('month')
  // The newest month with trades (else the current one).
  const [month, setMonth] = useState(reportMonths(rows)[0] ?? thisMonth)
  const [quarter, setQuarter] = useState(`${today.slice(0, 4)}-${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`)
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [custom, setCustom] = useState<DateRange>({ from: `${thisMonth}-01`, to: today })
  const [include, setInclude] = useState<ReportSectionId[]>(loadSections)

  const range: DateRange =
    kind === 'month'
      ? monthRange(month)
      : kind === 'quarter'
        ? quarterRange(Number(quarter.slice(0, 4)), Number(quarter.slice(5)))
        : kind === 'year'
          ? yearRange(year)
          : custom.from <= custom.to
            ? custom
            : { from: custom.to, to: custom.from }

  const report = useMemo(() => (journal ? buildReport(rows, days, journal, range) : null), [rows, days, journal, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (report ? reportSections(report, include) : null), [report, include])
  if (!journal || !report || !preview) return null

  const toggle = (id: ReportSectionId) => {
    const next = include.includes(id) ? include.filter((x) => x !== id) : REPORT_SECTIONS.map((s) => s.id).filter((x) => x === id || include.includes(x))
    setInclude(next)
    saveSections(next)
  }
  const setAll = (ids: readonly ReportSectionId[]) => {
    setInclude([...ids])
    saveSections(ids)
  }

  return (
    <div className="flex h-full min-h-0" data-testid="reports">
      <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-panel p-3 text-[12px]">
        <div className="flex flex-col gap-1.5">
          <span className="label">Okres</span>
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'month', label: 'Miesiąc' },
              { value: 'quarter', label: 'Kwartał' },
              { value: 'year', label: 'Rok' },
              { value: 'custom', label: 'Własny' }
            ]}
          />
          {kind === 'month' && (
            <select className="input h-[26px]" value={month} onChange={(e) => setMonth(e.currentTarget.value)} data-testid="report-month">
              {months.map((m) => (
                <option key={m} value={m}>
                  {rangeLabel(monthRange(m))}
                </option>
              ))}
            </select>
          )}
          {kind === 'quarter' && (
            <select className="input h-[26px]" value={quarter} onChange={(e) => setQuarter(e.currentTarget.value)} data-testid="report-quarter">
              {years.flatMap((y) =>
                [4, 3, 2, 1].map((q) => (
                  <option key={`${y}-${q}`} value={`${y}-${q}`}>
                    {QUARTER[q - 1]} kw. {y}
                  </option>
                ))
              )}
            </select>
          )}
          {kind === 'year' && (
            <select className="input h-[26px]" value={year} onChange={(e) => setYear(Number(e.currentTarget.value))} data-testid="report-year">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          {kind === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" className="input h-[26px] flex-1" value={custom.from} onChange={(e) => e.currentTarget.value && setCustom((c) => ({ ...c, from: e.currentTarget.value }))} data-testid="report-from" />
              <span className="text-dim">–</span>
              <input type="date" className="input h-[26px] flex-1" value={custom.to} onChange={(e) => e.currentTarget.value && setCustom((c) => ({ ...c, to: e.currentTarget.value }))} data-testid="report-to" />
            </div>
          )}
          <span className="text-[11px] text-dim">
            {range.from} – {range.to} (data NY wejścia; PIT-38 wg daty zamknięcia)
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="label flex-1">Sekcje raportu</span>
            <button className="text-[11px] text-accent hover:underline" onClick={() => setAll(REPORT_SECTIONS.map((s) => s.id))} data-testid="report-all">
              wszystkie
            </button>
            <button className="text-[11px] text-muted hover:underline" onClick={() => setAll(DEFAULT_REPORT_SECTIONS)}>
              domyślne
            </button>
          </div>
          {REPORT_SECTIONS.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 py-[1px]">
              <input type="checkbox" checked={include.includes(s.id)} onChange={() => toggle(s.id)} data-testid={`report-section-${s.id}`} />
              {s.label}
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <button className="btn btn-accent justify-center" disabled={!include.length} onClick={() => void deliverReport(report, include, 'pdf')} data-testid="report-pdf">
            Zapisz PDF
          </button>
          <div className="flex gap-1.5">
            <button className="btn flex-1 justify-center" disabled={!include.length} onClick={() => void deliverReport(report, include, 'md')} data-testid="report-md">
              Zapisz .md
            </button>
            <button className="btn flex-1 justify-center" disabled={!include.length} onClick={() => void deliverReport(report, include, 'copy')} data-testid="report-copy">
              Kopiuj markdown
            </button>
          </div>
        </div>
      </aside>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Panel title={`Podgląd – ${report.title}`} className="border-0">
          <div className="mx-auto flex max-w-[900px] flex-col gap-1 text-[12.5px]" data-testid="report-preview">
            <h1 className="text-[18px] font-semibold text-fg-strong">{report.title}</h1>
            <p className="num font-medium text-fg-strong" data-testid="report-lead">
              {preview.lead}
            </p>
            {!include.length && <p className="text-dim">Zaznacz co najmniej jedną sekcję.</p>}
            {preview.sections.map((s, i) => (
              <section key={`${s.heading}-${i}`} className="mt-3" data-testid="report-section">
                <h2 className="mb-1 border-b border-line pb-0.5 text-[13.5px] font-semibold text-fg-strong">{s.heading}</h2>
                {s.table && (
                  <table className="w-full border-collapse text-[12px]">
                    {s.table.head.some(Boolean) && (
                      <thead>
                        <tr>
                          {s.table.head.map((h, j) => (
                            <th key={j} className={cx('border-b border-line px-1.5 py-1 text-left font-medium text-muted', s.table!.right?.includes(j) && 'text-right')}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {s.table.rows.map((row, k) => (
                        <tr key={k}>
                          {row.map((c, j) => (
                            <td key={j} className={cx('border-b border-line/50 px-1.5 py-[3px]', s.table!.right?.includes(j) && 'num text-right')}>
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {s.lines && (
                  <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-fg">
                    {s.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
