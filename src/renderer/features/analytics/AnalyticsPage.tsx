import { useMemo, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import {
  applyFilter,
  breakdowns,
  calendarDays,
  complianceMatrix,
  equitySeries,
  extraStats,
  mistakeCosts,
  missedSummary,
  summaryOf,
  type ComplianceRow
} from '@shared/calc/analytics'
import type { Outcome } from '@shared/calc/trade'
import { buildMonthlyReport, reportLead, reportMonthLabel, reportMonths } from '@shared/export/monthlyReport'
import { fmtMoney, fmtNum, fmtPercent, fmtR, parseDateInput, tone, toneClass } from '../../lib/format'
import { useTradeRows } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { navigate } from '../../store/ui'
import { CalendarHeatmap } from '../../components/charts/CalendarHeatmap'
import { EquityChart } from '../../components/charts/EquityChart'
import { GroupTable } from '../../components/charts/GroupTable'
import { HourBars } from '../../components/charts/HourBars'
import { Panel, Segmented, cx } from '../../components/ui'
import { todayNy } from '../day/DayPlanPage'
import { deliverMonthlyReport } from '../export/reportActions'

type Preset = 'all' | '30' | '90' | 'ytd' | '365'

function presetRange(p: Preset): { from: string | null; to: string | null } {
  const today = DateTime.fromISO(todayNy())
  if (p === 'all') return { from: null, to: null }
  if (p === 'ytd') return { from: today.startOf('year').toISODate(), to: null }
  return { from: today.minus({ days: Number(p) }).toISODate(), to: null }
}

export function AnalyticsPage() {
  const rows = useTradeRows()
  const journal = useJournal((s) => s.journal)
  const [preset, setPreset] = useState<Preset>('all')
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [pairs, setPairs] = useState<string[]>([])

  const filtered = useMemo(() => applyFilter(rows, { from: range.from, to: range.to, pairs }), [rows, range, pairs])

  const data = useMemo(() => {
    if (!journal) return null
    const be = journal.settings.stats.breakevenThresholdR
    return {
      be,
      summary: summaryOf(filtered, be),
      extra: extraStats(filtered),
      equity: equitySeries(filtered),
      breakdowns: breakdowns(filtered, journal),
      matrix: complianceMatrix(filtered, be),
      mistakes: mistakeCosts(filtered, journal),
      calendar: calendarDays(filtered),
      missed: missedSummary(filtered, journal)
    }
  }, [filtered, journal])

  if (!journal || !data) return null
  const { summary: s, extra, be } = data
  const showMoney = journal.settings.display.showMoney
  const pairList = journal.settings.pairs.filter((p) => !p.archived || rows.some((r) => r.trade.pair === p.symbol))
  const dates = filtered.map((r) => r.m.tradingDate).sort()
  const calFrom = range.from ?? dates[0] ?? DateTime.fromISO(todayNy()).minus({ months: 3 }).toISODate()!
  const calTo = range.to ?? todayNy()

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="analytics">
      <div className="flex h-[36px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <Segmented
          size="sm"
          value={preset}
          onChange={(p) => {
            setPreset(p)
            setRange(presetRange(p))
          }}
          options={[
            { value: 'all', label: 'Wszystko' },
            { value: '30', label: '30 dni' },
            { value: '90', label: '90 dni' },
            { value: 'ytd', label: 'Od początku roku' },
            { value: '365', label: '12 mies.' }
          ]}
        />
        <DateBox value={range.from} placeholder="od" onChange={(from) => setRange((r) => ({ ...r, from }))} />
        <span className="text-dim">–</span>
        <DateBox value={range.to} placeholder="do" onChange={(to) => setRange((r) => ({ ...r, to }))} />
        <div className="ml-2 flex gap-1">
          {pairList.map((p) => (
            <button
              key={p.symbol}
              className="chip num"
              aria-pressed={pairs.includes(p.symbol)}
              onClick={() => setPairs((xs) => (xs.includes(p.symbol) ? xs.filter((x) => x !== p.symbol) : [...xs, p.symbol]))}
            >
              {p.symbol}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11.5px] text-muted">
          {pairs.length ? pairs.join(', ') : 'wszystkie pary'} · {filtered.length} wpisów
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* KPI strip */}
        <div className="grid grid-cols-6 border-b border-line" data-testid="kpis">
          <Kpi label="Transakcje" value={String(s.count)} sub={`${s.wins}W / ${s.losses}L / ${s.breakevens}BE`} />
          <Kpi label="Win rate" value={fmtPercent(s.winRate, 1)} sub="bez BE" />
          <Kpi label="Expectancy" value={fmtR(s.expectancy)} cls={toneClass[tone(s.expectancy)]} sub="średnio na transakcję" />
          <Kpi label="Profit factor" value={s.profitFactor == null ? '—' : Number.isFinite(s.profitFactor) ? fmtNum(s.profitFactor) : '∞'} />
          <Kpi label="Σ R" value={fmtR(s.totalR, 1)} cls={toneClass[tone(s.totalR, be)]} sub={showMoney && extra.pnlAmount != null ? fmtMoney(extra.pnlAmount, journal.settings.risk.accountCurrency) : undefined} />
          <Kpi label="Max drawdown" value={s.maxDrawdownR ? `−${s.maxDrawdownR.toFixed(2)}R` : '0.00R'} cls={s.maxDrawdownR ? 'text-down' : ''} />
          <Kpi label="Śr. wygrana" value={fmtR(s.avgWinR)} cls={toneClass[tone(s.avgWinR)]} />
          <Kpi label="Śr. strata" value={fmtR(s.avgLossR)} cls={toneClass[tone(s.avgLossR)]} />
          <Kpi label="Najdł. seria" value={`${s.longestWinStreak} W · ${s.longestLossStreak} L`} sub={s.currentStreak ? `teraz: ${Math.abs(s.currentStreak)} ${s.currentStreak > 0 ? 'W' : 'L'}` : undefined} />
          <Kpi label="Zgodność" value={fmtPercent(extra.complianceRate)} sub="transakcji bez złamanych zasad" />
          <Kpi label="Śr. SL" value={extra.avgRiskPips != null ? `${extra.avgRiskPips.toFixed(1)} p` : '—'} />
          <Kpi label="MFE wygr. / MAE strat" value={`${fmtNum(extra.avgMfeWinnersR, 1)} / ${fmtNum(extra.avgMaeLosersR, 1)}R`} />
        </div>

        <ReportBar />

        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
          <Section title="Krzywa equity (R) i drawdown" className="border-r">
            {data.equity.length ? <EquityChart points={data.equity} /> : <EmptyNote>Brak zamkniętych transakcji w wybranym zakresie.</EmptyNote>}
          </Section>
          <Section title="Zgodność z zasadami × wynik">
            <Matrix data={data.matrix} be={be} />
            <div className="mt-3 text-[11.5px] text-muted">„Zgodna” = żadna oceniana zasada nie została złamana. Bez danych = nie dało się ocenić żadnej zasady.</div>
          </Section>
        </div>

        <div className="grid grid-cols-3 border-t border-line">
          <Section title="Para" className="border-r">
            <GroupTable groups={data.breakdowns.pair} be={be} labelHeader="Para" />
          </Section>
          <Section title="Sesja (killzone)" className="border-r">
            <GroupTable groups={data.breakdowns.session} be={be} labelHeader="Sesja" />
          </Section>
          <Section title="Dzień tygodnia (NY)">
            <GroupTable groups={data.breakdowns.weekday} be={be} labelHeader="Dzień" />
          </Section>
          <Section title="Model wejścia" className="border-r border-t">
            <GroupTable groups={data.breakdowns.model} be={be} labelHeader="Model" />
          </Section>
          <Section title="PD array wejścia" className="border-r border-t">
            <GroupTable groups={data.breakdowns.pdArray} be={be} labelHeader="PD array" />
          </Section>
          <Section title="Godzina wejścia (NY)" className="border-t">
            <HourBars groups={data.breakdowns.hour} />
          </Section>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-t border-line">
          <Section title="Koszt tagów błędów" className="border-r">
            <MistakeTable data={data.mistakes} be={be} />
          </Section>
          <Section title={`Missed trades (${data.missed.count})`}>
            {data.missed.count === 0 ? (
              <EmptyNote>Brak missed trades w zakresie.</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2 text-[12px]">
                <div>
                  Przeszło obok: <span className={cx('num text-[15px] font-medium', toneClass[tone(data.missed.totalR, be)])}>{fmtR(data.missed.totalR, 1)}</span>
                  <span className="ml-2 text-muted">hipotetycznie, z {data.missed.rated} ocenionych</span>
                </div>
                {data.missed.byReason.map((r) => (
                  <div key={r.reasonId} className="grid grid-cols-[minmax(0,1fr)_34px_70px] border-b border-line/50 py-[3px] last:border-b-0">
                    <span className="truncate">{r.name}</span>
                    <span className="num text-right text-muted">{r.count}</span>
                    <span className={cx('num text-right', toneClass[tone(r.totalR, be)])}>{fmtR(r.totalR, 1)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <Section title="Kalendarz wyników (Σ R dziennie)" className="border-t">
          <CalendarHeatmap days={data.calendar} from={calFrom} to={calTo} onPick={(date) => navigate({ page: 'day', date })} />
        </Section>
      </div>
    </div>
  )
}

/** Monthly report of the whole journal (all pairs, regardless of the filters above): markdown or PDF. */
function ReportBar() {
  const rows = useTradeRows()
  const journal = useJournal((s) => s.journal)
  const days = useJournal((s) => s.days)
  const drafts = useJournal((s) => s.drafts)
  const kept = useMemo(() => rows.filter((r) => !drafts[r.trade.id]), [rows, drafts])
  const months = useMemo(() => reportMonths(kept), [kept])
  const [picked, setPicked] = useState<string | null>(null)
  const month = picked && months.includes(picked) ? picked : (months[0] ?? null)
  const lead = useMemo(
    () =>
      journal && month
        ? reportLead(
            buildMonthlyReport(
              kept,
              Object.values(days).map((e) => e.record),
              journal,
              month
            )
          )
        : null,
    [kept, days, journal, month]
  )
  return (
    <div className="flex h-[34px] items-center gap-2 border-b border-line bg-panel px-3 text-[12px]" data-testid="monthly-report">
      <span className="label">Raport miesięczny</span>
      {month ? (
        <>
          <select className="input h-[24px] w-[150px]" value={month} onChange={(e) => setPicked(e.currentTarget.value)} aria-label="Miesiąc raportu" data-testid="report-month">
            {months.map((m) => (
              <option key={m} value={m}>
                {reportMonthLabel(m)}
              </option>
            ))}
          </select>
          <span className="num min-w-0 flex-1 truncate text-muted" title={lead ?? undefined} data-testid="report-lead">
            {lead}
          </span>
          <button className="btn h-[24px]" onClick={() => void deliverMonthlyReport(month, 'copy')} data-testid="report-copy">
            Kopiuj markdown
          </button>
          <button className="btn h-[24px]" onClick={() => void deliverMonthlyReport(month, 'md')} data-testid="report-md">
            Zapisz .md
          </button>
          <button className="btn h-[24px]" onClick={() => void deliverMonthlyReport(month, 'pdf')} data-testid="report-pdf">
            Zapisz PDF
          </button>
        </>
      ) : (
        <span className="text-dim">brak transakcji</span>
      )}
    </div>
  )
}

function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Panel title={title} className={cx('border-0 border-line', className)}>
      {children}
    </Panel>
  )
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-[12px] text-dim">{children}</div>
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-r border-b border-line bg-panel px-3 py-2">
      <span className="label truncate">{label}</span>
      <span className={cx('num truncate text-[17px] font-medium text-fg-strong', cls)}>{value}</span>
      {sub && <span className="num truncate text-[10.5px] text-dim">{sub}</span>}
    </div>
  )
}

const OUTCOMES: Array<{ key: Outcome; label: string }> = [
  { key: 'win', label: 'Wygrane' },
  { key: 'breakeven', label: 'BE' },
  { key: 'loss', label: 'Przegrane' }
]
const ROWS: Array<{ key: ComplianceRow; label: string }> = [
  { key: 'compliant', label: 'Zgodne z zasadami' },
  { key: 'broken', label: 'Złamane zasady' },
  { key: 'unrated', label: 'Bez oceny' }
]

function Matrix({ data, be }: { data: ReturnType<typeof complianceMatrix>; be: number }) {
  return (
    <div className="border border-line text-[12px]" data-testid="compliance-matrix">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] border-b border-line bg-raised text-[10.5px] tracking-wide text-muted uppercase">
        <span className="px-2 py-1" />
        {OUTCOMES.map((o) => (
          <span key={o.key} className="px-2 py-1 text-right">
            {o.label}
          </span>
        ))}
        <span className="px-2 py-1 text-right">Razem</span>
      </div>
      {ROWS.map((row) => {
        const r = data[row.key]
        return (
          <div key={row.key} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] border-b border-line/60 last:border-b-0">
            <span className="px-2 py-1.5">{row.label}</span>
            {OUTCOMES.map((o) => (
              <span key={o.key} className="flex flex-col items-end px-2 py-1">
                <span className="num text-fg-strong">{r[o.key].count}</span>
                <span className={cx('num text-[10.5px]', toneClass[tone(r[o.key].totalR, be)])}>{r[o.key].count ? fmtR(r[o.key].totalR, 1) : ''}</span>
              </span>
            ))}
            <span className="flex flex-col items-end px-2 py-1">
              <span className="num text-fg-strong">{r.total.count}</span>
              <span className={cx('num text-[10.5px]', toneClass[tone(r.total.totalR, be)])}>
                {r.total.count ? `${fmtR(r.total.totalR, 1)} · E ${fmtR(r.total.totalR / r.total.count)}` : ''}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MistakeTable({ data, be }: { data: ReturnType<typeof mistakeCosts>; be: number }) {
  if (data.tags.length === 0) return <EmptyNote>Żadna zamknięta transakcja nie ma tagu błędu.</EmptyNote>
  return (
    <div className="text-[12px]" data-testid="mistake-costs">
      <div className="mb-1.5 text-[11.5px] text-muted">
        Punkt odniesienia: średnio {fmtR(data.baselineAvgR)} na transakcję bez błędów ({data.cleanCount}). Koszt = Σ R z tagiem − tyle samo „czystych” transakcji.
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_34px_62px_62px_70px] border-b border-line pb-1 text-[10.5px] tracking-wide text-muted uppercase">
        <span>Tag</span>
        <span className="text-right">n</span>
        <span className="text-right">Σ R</span>
        <span className="text-right">śr. R</span>
        <span className="text-right">Koszt</span>
      </div>
      {data.tags.map((t) => (
        <div key={t.tagId} className="grid grid-cols-[minmax(0,1fr)_34px_62px_62px_70px] border-b border-line/50 py-[3px] last:border-b-0">
          <span className="truncate">{t.name}</span>
          <span className="num text-right text-muted">{t.count}</span>
          <span className={cx('num text-right', toneClass[tone(t.totalR, be)])}>{fmtR(t.totalR, 1)}</span>
          <span className={cx('num text-right', toneClass[tone(t.avgR, be)])}>{fmtR(t.avgR)}</span>
          <span className={cx('num text-right font-medium', toneClass[tone(t.costR, be)])}>{fmtR(t.costR, 1)}</span>
        </div>
      ))}
    </div>
  )
}

function DateBox({ value, placeholder, onChange }: { value: string | null; placeholder: string; onChange: (v: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input num w-[98px] text-center"
      value={draft ?? value ?? ''}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        if (draft != null) {
          const text = draft.trim()
          const date = text ? parseDateInput(text) : null
          if (!text || date) onChange(date)
        }
        setDraft(null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
