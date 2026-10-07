import { useMemo, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import {
  applyFilter,
  breakdowns,
  customFieldBreakdowns,
  calendarDays,
  complianceMatrix,
  equitySeries,
  extraStats,
  mistakeCosts,
  missedSummary,
  summaryOf,
  type AnalyzedTrade,
  type ComplianceRow
} from '@shared/calc/analytics'
import type { JournalFile } from '@shared/schema'
import type { Outcome } from '@shared/calc/trade'
import { plnByTrade, plnCurve, type PlnCurve } from '@shared/calc/plnCurve'
import { periodMetrics, previousRange, rangeLabel, type DateRange } from '@shared/calc/periods'
import { fmtMoney, fmtMoneyGrouped, fmtNum, fmtPercent, fmtR, parseDateInput, tone, toneClass } from '../../lib/format'
import { toggleMoney } from '../money'
import { useTradeRows } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { navigate } from '../../store/ui'
import { CalendarHeatmap } from '../../components/charts/CalendarHeatmap'
import { EquityChart } from '../../components/charts/EquityChart'
import { GroupTable } from '../../components/charts/GroupTable'
import { HourBars } from '../../components/charts/HourBars'
import { WeekdayHourHeatmap } from '../../components/charts/WeekdayHourHeatmap'
import { Panel, Segmented, cx } from '../../components/ui'
import { todayNy } from '../day/DayPlanPage'
import { SelectionPanel } from '../sessions/SelectionPanel'
import { WellbeingPanel } from '../wellbeing/Wellbeing'

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
  const [plnEstimates, setPlnEstimates] = useState(true)
  const [calMetric, setCalMetric] = useState<'r' | 'pln'>('r')
  const showMoney = journal?.settings.display.showMoney ?? false

  const filtered = useMemo(() => applyFilter(rows, { from: range.from, to: range.to, pairs }), [rows, range, pairs])
  const byPairs = useMemo(() => applyFilter(rows, { from: null, to: null, pairs }), [rows, pairs])

  const data = useMemo(() => {
    if (!journal) return null
    const be = journal.settings.stats.breakevenThresholdR
    // PLN of each trade for the breakdowns and the calendar (only when amounts are shown).
    const plnOf = showMoney ? plnByTrade(filtered, journal, plnEstimates) : undefined
    return {
      be,
      summary: summaryOf(filtered, be),
      extra: extraStats(filtered),
      equity: equitySeries(filtered),
      breakdowns: breakdowns(filtered, journal, plnOf),
      custom: customFieldBreakdowns(filtered, journal, plnOf),
      matrix: complianceMatrix(filtered, be),
      mistakes: mistakeCosts(filtered, journal),
      calendar: calendarDays(filtered, plnOf),
      missed: missedSummary(filtered, journal)
    }
  }, [filtered, journal, showMoney, plnEstimates])
  const pln = useMemo(() => (journal ? plnCurve(filtered, journal, { estimates: plnEstimates }) : null), [filtered, journal, plnEstimates])

  if (!journal || !data) return null
  const { summary: s, extra, be } = data
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

        {pln && <PlnSection curve={pln} showMoney={showMoney} estimates={plnEstimates} onEstimates={setPlnEstimates} />}

        <ComparisonSection rows={byPairs} journal={journal} showMoney={showMoney} be={be} estimates={plnEstimates} />

        <div className="grid grid-cols-3 border-t border-line">
          <Section title="Para" className="border-r">
            <GroupTable groups={data.breakdowns.pair} be={be} labelHeader="Para" money={showMoney} />
          </Section>
          <Section title="Sesja (killzone)" className="border-r">
            <GroupTable groups={data.breakdowns.session} be={be} labelHeader="Sesja" money={showMoney} />
          </Section>
          <Section title="Dzień tygodnia (NY)">
            <GroupTable groups={data.breakdowns.weekday} be={be} labelHeader="Dzień" money={showMoney} />
          </Section>
          <Section title="Model wejścia" className="border-r border-t">
            <GroupTable groups={data.breakdowns.model} be={be} labelHeader="Model" money={showMoney} />
          </Section>
          <Section title="PD array wejścia" className="border-r border-t">
            <GroupTable groups={data.breakdowns.pdArray} be={be} labelHeader="PD array" money={showMoney} />
          </Section>
          <Section title="Godzina wejścia (NY)" className="border-t">
            <HourBars groups={data.breakdowns.hour} />
          </Section>
        </div>

        {data.custom.length > 0 && (
          <div className="grid grid-cols-3 border-t border-line" data-testid="custom-breakdowns">
            {data.custom.map(({ field, groups }, i) => (
              <Section key={field.id} title={`Własne pole: ${field.name}`} className={cx(i % 3 < 2 && 'border-r', i >= 3 && 'border-t')}>
                <GroupTable groups={groups} be={be} labelHeader={field.name} money={showMoney} />
              </Section>
            ))}
          </div>
        )}

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

        <Section title="Mapa godzin: dzień tygodnia × godzina wejścia (NY)" className="border-t">
          <WeekdayHourHeatmap rows={filtered} />
        </Section>

        <SelectionPanel rows={filtered} from={range.from} to={range.to} />
        <WellbeingPanel rows={filtered} from={range.from} to={range.to} />

        <Section
          title={
            <span className="flex items-center gap-2">
              Kalendarz wyników ({calMetric === 'pln' && showMoney ? 'Σ PLN' : 'Σ R'} dziennie)
              {showMoney && (
                <Segmented
                  size="sm"
                  value={calMetric}
                  onChange={setCalMetric}
                  options={[
                    { value: 'r', label: 'R' },
                    { value: 'pln', label: 'PLN' }
                  ]}
                />
              )}
            </span>
          }
          className="border-t"
        >
          <CalendarHeatmap days={data.calendar} from={calFrom} to={calTo} metric={showMoney ? calMetric : 'r'} onPick={(date) => navigate({ page: 'day', date })} />
        </Section>
      </div>
    </div>
  )
}

/** Reports moved to their own page (Ctrl+9): a pointer for those who look for them here. */
function ReportBar() {
  return (
    <div className="flex h-[30px] items-center gap-2 border-b border-line bg-panel px-3 text-[12px] text-muted" data-testid="reports-link">
      Raporty (dowolny okres, wybrane sekcje, PIT-38, PDF / markdown) są na osobnej stronie:
      <button className="text-accent hover:underline" onClick={() => navigate({ page: 'reports' })}>
        Raporty (Ctrl+9)
      </button>
    </div>
  )
}

type ComparePreset = 'week' | 'month' | 'quarter' | 'year' | 'custom'

/** Two periods side by side: the current one (week / month / quarter / year containing today) and the one before, or own dates. */
function ComparisonSection({ rows, journal, showMoney, be, estimates }: { rows: readonly AnalyzedTrade[]; journal: JournalFile; showMoney: boolean; be: number; estimates: boolean }) {
  const [preset, setPreset] = useState<ComparePreset>('month')
  const today = DateTime.fromISO(todayNy(), { zone: 'UTC' })
  const [custom, setCustom] = useState<{ a: DateRange; b: DateRange }>(() => {
    const a = { from: today.startOf('month').toISODate()!, to: today.toISODate()! }
    return { a, b: previousRange(a) }
  })
  const unit = preset === 'custom' ? null : preset
  const a: DateRange = unit ? { from: today.startOf(unit).toISODate()!, to: today.endOf(unit).toISODate()! } : custom.a
  const b: DateRange = unit ? previousRange(a) : custom.b
  const plnOf = useMemo(() => (showMoney ? plnByTrade(rows, journal, estimates) : undefined), [rows, journal, showMoney, estimates])
  const [ma, mb] = useMemo(() => [periodMetrics(rows, a, be, plnOf), periodMetrics(rows, b, be, plnOf)], [rows, a.from, a.to, b.from, b.to, be, plnOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const pctPts = (x: number | null, y: number | null) => (x == null || y == null ? null : (x - y) * 100)
  const line = (label: string, va: string, vb: string, delta: number | null, fmt: (v: number) => string, betterUp = true) => (
    <tr className="border-b border-line/50" data-testid="compare-row">
      <td className="py-[3px] text-muted">{label}</td>
      <td className="num text-right">{va}</td>
      <td className="num text-right">{vb}</td>
      <td className={cx('num text-right', delta == null || Math.abs(delta) < 1e-9 ? 'text-dim' : (delta > 0) === betterUp ? 'text-up' : 'text-down')}>
        {delta == null ? '—' : fmt(delta)}
      </td>
    </tr>
  )
  const sgn = (v: number, d: number, unitText = '') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}${unitText}`
  return (
    <div className="border-t border-line" data-testid="compare">
      <Section
        title={
          <span className="flex items-center gap-2">
            Porównanie okresów
            <Segmented
              size="sm"
              value={preset}
              onChange={setPreset}
              options={[
                { value: 'week', label: 'Tydzień' },
                { value: 'month', label: 'Miesiąc' },
                { value: 'quarter', label: 'Kwartał' },
                { value: 'year', label: 'Rok' },
                { value: 'custom', label: 'Własne' }
              ]}
            />
          </span>
        }
      >
        {preset === 'custom' && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted">A</span>
            <DateBox value={custom.a.from} placeholder="od" onChange={(v) => v && setCustom((c) => ({ ...c, a: { ...c.a, from: v } }))} />
            <DateBox value={custom.a.to} placeholder="do" onChange={(v) => v && setCustom((c) => ({ ...c, a: { ...c.a, to: v } }))} />
            <span className="ml-3 text-muted">B</span>
            <DateBox value={custom.b.from} placeholder="od" onChange={(v) => v && setCustom((c) => ({ ...c, b: { ...c.b, from: v } }))} />
            <DateBox value={custom.b.to} placeholder="do" onChange={(v) => v && setCustom((c) => ({ ...c, b: { ...c.b, to: v } }))} />
          </div>
        )}
        <table className="w-full max-w-[760px] text-[12px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] tracking-wide text-muted uppercase">
              <th className="py-1 text-left font-normal" />
              <th className="text-right font-normal" data-testid="compare-a">
                {rangeLabel(a)}
              </th>
              <th className="text-right font-normal" data-testid="compare-b">
                {rangeLabel(b)}
              </th>
              <th className="text-right font-normal">Zmiana</th>
            </tr>
          </thead>
          <tbody>
            {line('Transakcje', String(ma.trades), String(mb.trades), ma.trades - mb.trades, (v) => sgn(v, 0))}
            {line('Win rate', fmtPercent(ma.winRate, 1), fmtPercent(mb.winRate, 1), pctPts(ma.winRate, mb.winRate), (v) => sgn(v, 1, ' pkt'))}
            {line('Σ R', fmtR(ma.totalR), fmtR(mb.totalR), ma.totalR - mb.totalR, (v) => sgn(v, 2, 'R'))}
            {line('Expectancy', fmtR(ma.expectancy), fmtR(mb.expectancy), ma.expectancy != null && mb.expectancy != null ? ma.expectancy - mb.expectancy : null, (v) => sgn(v, 2, 'R'))}
            {line(
              'Profit factor',
              ma.profitFactor == null ? '—' : Number.isFinite(ma.profitFactor) ? fmtNum(ma.profitFactor) : '∞',
              mb.profitFactor == null ? '—' : Number.isFinite(mb.profitFactor) ? fmtNum(mb.profitFactor) : '∞',
              ma.profitFactor != null && mb.profitFactor != null && Number.isFinite(ma.profitFactor) && Number.isFinite(mb.profitFactor) ? ma.profitFactor - mb.profitFactor : null,
              (v) => sgn(v, 2)
            )}
            {line('Max drawdown', `${ma.maxDrawdownR.toFixed(2)}R`, `${mb.maxDrawdownR.toFixed(2)}R`, ma.maxDrawdownR - mb.maxDrawdownR, (v) => sgn(v, 2, 'R'), false)}
            {line('Śr. wygrana', fmtR(ma.avgWinR), fmtR(mb.avgWinR), ma.avgWinR != null && mb.avgWinR != null ? ma.avgWinR - mb.avgWinR : null, (v) => sgn(v, 2, 'R'))}
            {line('Śr. strata', fmtR(ma.avgLossR), fmtR(mb.avgLossR), ma.avgLossR != null && mb.avgLossR != null ? ma.avgLossR - mb.avgLossR : null, (v) => sgn(v, 2, 'R'))}
            {line('Zgodność z zasadami', fmtPercent(ma.compliance), fmtPercent(mb.compliance), pctPts(ma.compliance, mb.compliance), (v) => sgn(v, 1, ' pkt'))}
            {showMoney &&
              line(
                'Wynik w PLN',
                ma.pln == null ? '—' : fmtMoneyGrouped(ma.pln, 'PLN'),
                mb.pln == null ? '—' : fmtMoneyGrouped(mb.pln, 'PLN'),
                ma.pln != null || mb.pln != null ? (ma.pln ?? 0) - (mb.pln ?? 0) : null,
                (v) => fmtMoneyGrouped(v, 'PLN')
              )}
          </tbody>
        </table>
        <div className="mt-1.5 text-[11px] text-dim">
          Wybrane pary z paska u góry; daty porównania niezależne od zakresu u góry. Max drawdown – mniej znaczy lepiej.
        </div>
      </Section>
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

const formatPln = (v: number) => fmtMoneyGrouped(v, 'PLN')

/** Earnings curve in PLN: cumulative money result of closed trades (NBP rates), drawdown, and how it was counted. */
function PlnSection({ curve: c, showMoney, estimates, onEstimates }: { curve: PlnCurve; showMoney: boolean; estimates: boolean; onEstimates: (v: boolean) => void }) {
  if (!showMoney)
    return (
      <div className="border-t border-line">
        <Section title="Krzywa zarobków (PLN)">
          <div className="flex items-center justify-center gap-3 py-4 text-[12px] text-muted" data-testid="pln-hidden">
            Kwoty są ukryte (Ctrl+$).
            <button className="btn" onClick={toggleMoney} data-testid="pln-show">
              Pokaż kwoty
            </button>
          </div>
        </Section>
      </div>
    )
  const left = c.noAmount + c.withoutRate
  const line = (label: string, value: ReactNode, testId?: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-[3px]">
      <span className="text-muted">{label}</span>
      <span className="num text-right" data-testid={testId}>
        {value}
      </span>
    </div>
  )
  const money = (v: number | null) => <span className={toneClass[tone(v)]}>{v == null ? '—' : formatPln(v)}</span>
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] border-t border-line" data-testid="pln-curve">
      <Section title="Krzywa zarobków (PLN) i drawdown" className="border-r">
        {c.points.length ? (
          <EquityChart points={c.points} format={formatPln} testId="pln-chart" />
        ) : (
          <EmptyNote>Brak zamkniętych transakcji z kwotą w wybranym zakresie – wpisz w transakcjach wynik w kwocie albo loty.</EmptyNote>
        )}
      </Section>
      <Section title="Zarobki w PLN">
        <div className="text-[12px]" data-testid="pln-stats">
          {line('Wynik', <span className="text-[15px] font-medium">{money(c.points.length ? c.total : null)}</span>, 'pln-total')}
          {line('Max drawdown', <span className={c.maxDrawdown ? 'text-down' : ''}>{c.maxDrawdown ? formatPln(-c.maxDrawdown) : formatPln(0)}</span>, 'pln-dd')}
          {line('Najlepsza / najgorsza', <>{money(c.best)} / {money(c.worst)}</>)}
          {line('Śr. wygrana / strata', <>{money(c.avgWin)} / {money(c.avgLoss)}</>)}
          {line('Transakcje w krzywej', `${c.points.length} z ${c.closed}`, 'pln-count')}
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-[12px]">
          <input type="checkbox" checked={estimates} onChange={(e) => onEstimates(e.currentTarget.checked)} data-testid="pln-estimates" />
          Szacuj transakcje bez kwoty: R × ryzyko % × saldo konta
        </label>
        <div className="mt-2 flex flex-col gap-0.5 text-[11px] text-dim" data-testid="pln-notes">
          {c.estimated > 0 && <span className="text-accent">≈ {c.estimated} z szacunku (saldo konta z kalkulatora pozycji, nie z dnia transakcji).</span>}
          {c.historical > 0 && <span>{c.historical} przeliczono kursem NBP z dnia przed zamknięciem.</span>}
          {c.current > 0 && <span>{c.current} przeliczono dzisiejszym kursem (brak kursu z dnia transakcji).</span>}
          {left > 0 && (
            <span className="text-accent">
              Pominięto {left}:{c.noAmount ? ` ${c.noAmount} bez kwoty${estimates ? ' i bez danych do szacunku' : ''}` : ''}
              {c.noAmount && c.withoutRate ? ',' : ''}
              {c.withoutRate ? ` ${c.withoutRate} bez kursu ${c.missingRates.join('/')} → PLN` : ''}.
            </span>
          )}
        </div>
      </Section>
    </div>
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
