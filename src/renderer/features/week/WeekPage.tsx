import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import { newId } from '@shared/ids'
import { parseTradingViewCsv, weekExtremes, weeksInBars } from '@shared/calc/ohlc'
import { summarize } from '@shared/calc/stats'
import { isoWeekOf } from '@shared/calc/time'
import { SCHEMA_VERSION, WEEKDAYS, weekPairSchema, weekReviewSchema, type Weekday, type WeekPair, type WeekReview } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { fmtPercent, fmtR, parseClockInput, tone, toneClass } from '../../lib/format'
import { useTradeRows } from '../../store/derived'
import { addRecord, discardDraft, updateRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'
import { IconBack, IconNext } from '../../components/icons'
import { Badge, NumberField, Panel, Segmented, TextArea, cx } from '../../components/ui'
import { HistoryButton } from '../history/HistoryDialog'
import { todayNy } from '../day/DayPlanPage'

const DAY_LABEL: Record<Weekday, string> = { mon: 'Pon', tue: 'Wt', wed: 'Śr', thu: 'Czw', fri: 'Pt' }

export function currentWeek(): string {
  return isoWeekOf(todayNy())
}

export function shiftWeek(week: string, delta: number): string {
  const [y, w] = week.split('-W').map(Number) as [number, number]
  const d = DateTime.fromObject({ weekYear: y, weekNumber: w, weekday: 1 }).plus({ weeks: delta })
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, '0')}`
}

function weekDates(week: string): string[] {
  const [y, w] = week.split('-W').map(Number) as [number, number]
  const mon = DateTime.fromObject({ weekYear: y, weekNumber: w, weekday: 1 })
  return [0, 1, 2, 3, 4].map((i) => mon.plus({ days: i }).toISODate() as string)
}

function emptyPair(pair: string): WeekPair {
  return weekPairSchema.parse({ pair })
}

export function WeekPage({ week }: { week: string }) {
  const weeks = useJournal((s) => s.weeks)
  const journal = useJournal((s) => s.journal)
  const readOnly = useJournal((s) => s.status?.readOnly ?? false)
  const entry = useMemo(() => Object.values(weeks).find((e) => e.record.week === week) ?? null, [weeks, week])
  const prev = useMemo(() => Object.values(weeks).find((e) => e.record.week === shiftWeek(week, -1))?.record ?? null, [weeks, week])
  const [activePair, setActivePair] = useState<string | null>(null)

  useEffect(() => {
    if (entry || !journal || readOnly) return
    const now = new Date().toISOString()
    const pairs = prev?.pairs.map((p) => p.pair) ?? ['EURUSD']
    addRecord('weeks', weekReviewSchema.parse({ schemaVersion: SCHEMA_VERSION, id: newId(), createdAt: now, updatedAt: now, week, pairs: pairs.map((pair) => ({ pair })) }), { draft: true })
  }, [entry, journal, week, prev, readOnly])
  const id = entry?.record.id
  useEffect(() => () => {
    if (id) discardDraft('weeks', id)
  }, [id])

  if (!journal) return null
  const review = entry?.record ?? null
  const up = (fn: (w: WeekReview) => WeekReview) => id && updateRecord('weeks', id, fn)
  const dates = weekDates(week)
  const section = review?.pairs.find((p) => p.pair === activePair) ?? review?.pairs[0] ?? null
  const setSection = (pair: string, fn: (p: WeekPair) => WeekPair) => up((w) => ({ ...w, pairs: w.pairs.map((p) => (p.pair === pair ? fn(p) : p)) }))

  const importCsv = async () => {
    if (!section) return
    try {
      const file = await api.pickTextFile({ name: 'CSV z TradingView', extensions: ['csv', 'txt'] })
      if (!file) return
      const { bars, skipped } = parseTradingViewCsv(file.text)
      const res = weekExtremes(bars, week)
      if (res.barCount === 0) {
        const available = weeksInBars(bars).slice(0, 6).join(', ')
        toast(`Plik nie zawiera świec z tygodnia ${week}. Dostępne: ${available || 'brak'}.`, 'error', 7000)
        return
      }
      setSection(section.pair, (p) => ({ ...p, days: res.days, weekHighDay: res.weekHighDay, weekLowDay: res.weekLowDay, source: 'csv' }))
      toast(`Zaimportowano ${res.barCount} świec (${file.name})${skipped ? `, pominięto ${skipped} wierszy` : ''}.`, 'success')
    } catch (e) {
      toast(`Import CSV: ${errorMessage(e)}`, 'error', 7000)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="week">
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <button className="btn btn-ghost px-1.5" onClick={() => navigate({ page: 'week', week: shiftWeek(week, -1) })} title="Poprzedni tydzień">
          <IconBack />
        </button>
        <span className="num text-[13px] font-medium text-fg-strong">{week}</span>
        <span className="num text-muted">
          {dates[0]} – {dates[4]}
        </span>
        <button className="btn btn-ghost px-1.5" onClick={() => navigate({ page: 'week', week: shiftWeek(week, 1) })} title="Następny tydzień">
          <IconNext />
        </button>
        {week !== currentWeek() && (
          <button className="btn h-[22px]" onClick={() => navigate({ page: 'week', week: currentWeek() })}>
            Bieżący tydzień
          </button>
        )}
        {review && entry?.relPath ? (
          <span className="ml-auto">
            <HistoryButton kind="weeks" id={review.id} current={review} small />
          </span>
        ) : null}
      </div>
      {!review ? (
        <div className="p-6 text-muted">{readOnly ? 'Brak przeglądu tego tygodnia.' : 'Tworzenie przeglądu…'}</div>
      ) : (
        <fieldset disabled={readOnly} className="grid min-h-0 flex-1 grid-cols-[minmax(520px,1.3fr)_minmax(360px,1fr)]">
          <div className="flex min-h-0 flex-col overflow-y-auto border-r border-line">
            <div className="flex h-[32px] shrink-0 items-center gap-1 border-b border-line px-2">
              {review.pairs.map((p) => (
                <button key={p.pair} className={cx('chip num', section?.pair === p.pair && 'border-accent/60 text-accent')} onClick={() => setActivePair(p.pair)}>
                  {p.pair}
                </button>
              ))}
              <select
                className="input ml-1 h-[22px] w-[110px] px-1 text-[11.5px]"
                value=""
                onChange={(e) => {
                  const pair = e.currentTarget.value
                  if (!pair) return
                  up((w) => ({ ...w, pairs: [...w.pairs, emptyPair(pair)] }))
                  setActivePair(pair)
                }}
                aria-label="Dodaj parę"
              >
                <option value="">+ para…</option>
                {journal.settings.pairs
                  .filter((p) => !p.archived && !review.pairs.some((x) => x.pair === p.symbol))
                  .map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.symbol}
                    </option>
                  ))}
              </select>
              <button className="btn ml-auto h-[22px]" onClick={importCsv} data-testid="import-ohlc" title="TradingView: menu wykresu → Export chart data… (najlepiej M5–M15)">
                Import CSV z TradingView
              </button>
            </div>
            {section && <PairTable key={section.pair} section={section} dates={dates} onChange={(fn) => setSection(section.pair, fn)} />}
            <Section title="Wnioski z tygodnia">
              <TextArea value={review.conclusions} onChange={(conclusions) => up((w) => ({ ...w, conclusions }))} rows={4} placeholder="Kiedy powstawały high/low dnia? Który dzień zrobił ekstremum tygodnia? Co z tego wynika dla wejść?" data-testid="week-conclusions" />
            </Section>
          </div>
          <div className="flex min-h-0 flex-col overflow-y-auto">
            <Section title="Cel na kolejny tydzień (jeden)">
              <TextArea value={review.goalNextWeek} onChange={(goalNextWeek) => up((w) => ({ ...w, goalNextWeek }))} rows={2} placeholder="np. Wchodzę tylko po MSS z displacementem w killzone" data-testid="week-goal" />
            </Section>
            <Section title="Cel z poprzedniego tygodnia">
              {prev?.goalNextWeek ? (
                <div className="flex flex-col gap-2">
                  <div className="border-l-2 border-accent pl-2 text-fg-strong">{prev.goalNextWeek}</div>
                  <Segmented
                    value={review.previousGoalResult}
                    onChange={(previousGoalResult) => up((w) => ({ ...w, previousGoalResult }))}
                    options={[
                      { value: 'yes', label: 'Zrealizowany' },
                      { value: 'partial', label: 'Częściowo' },
                      { value: 'no', label: 'Nie' }
                    ]}
                  />
                  <input className="input" value={review.previousGoalNote} placeholder="dlaczego?" onChange={(e) => up((w) => ({ ...w, previousGoalNote: e.currentTarget.value }))} />
                </div>
              ) : (
                <span className="text-[11.5px] text-dim">Poprzedni tydzień nie ma zapisanego celu.</span>
              )}
            </Section>
            <WeekTrades dates={dates} />
          </div>
        </fieldset>
      )}
    </div>
  )
}

function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Panel title={title} className={cx('border-0 border-b', className)}>
      {children}
    </Panel>
  )
}

function ClockCell({ value, onChange, testId }: { value: string | null; onChange: (v: string | null) => void; testId?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input num w-full px-1 text-center"
      value={draft ?? value ?? ''}
      placeholder="GG:MM"
      aria-invalid={draft != null && draft.trim() !== '' && !parseClockInput(draft)}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        if (draft != null) {
          const text = draft.trim()
          const clock = text ? parseClockInput(text) : null
          // Invalid input (e.g. 25:00) reverts instead of erasing the stored time.
          if ((!text || clock) && clock !== value) onChange(clock)
        }
        setDraft(null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      data-testid={testId}
    />
  )
}

function PairTable({ section, dates, onChange }: { section: WeekPair; dates: string[]; onChange: (fn: (p: WeekPair) => WeekPair) => void }) {
  const dec = useJournal((s) => s.journal?.settings.pairs.find((p) => p.symbol === section.pair)?.priceDecimals ?? 5)
  const setDay = (day: Weekday, patch: Partial<WeekPair['days'][number]>) => onChange((p) => ({ ...p, days: p.days.map((d) => (d.day === day ? { ...d, ...patch } : d)) }))
  const hours = (key: 'highTimeNy' | 'lowTimeNy') =>
    section.days
      .map((d) => d[key])
      .filter((x): x is string => !!x)
      .map((t) => Number(t.slice(0, 2)))
  const sessionOf = (h: number) => (h >= 2 && h < 5 ? 'London' : h >= 7 && h < 11 ? 'NY' : h < 2 || h >= 19 ? 'Azja' : 'inne')
  const tally = (hs: number[]) => {
    const m = new Map<string, number>()
    for (const h of hs) m.set(sessionOf(h), (m.get(sessionOf(h)) ?? 0) + 1)
    return [...m.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') || '—'
  }
  return (
    <Section title={`${section.pair}: high / low dnia (czas NY)${section.source === 'csv' ? ' · z CSV' : ''}`}>
      <div className="grid grid-cols-[52px_1fr_70px_1fr_70px_64px_64px] items-center gap-x-1.5 border-b border-line pb-1 text-[10.5px] tracking-wide text-muted uppercase">
        <span>Dzień</span>
        <span className="text-right">High</span>
        <span className="text-center">Godz.</span>
        <span className="text-right">Low</span>
        <span className="text-center">Godz.</span>
        <span className="text-center">High tyg.</span>
        <span className="text-center">Low tyg.</span>
      </div>
      {section.days.map((d, i) => (
        <div key={d.day} className="grid grid-cols-[52px_1fr_70px_1fr_70px_64px_64px] items-center gap-x-1.5 border-b border-line/50 py-1">
          <span className="text-[12px]">
            {DAY_LABEL[d.day]} <span className="num text-[10.5px] text-dim">{dates[i]?.slice(8)}</span>
          </span>
          <NumberField value={d.high} decimals={dec} onChange={(high) => setDay(d.day, { high })} aria-label={`High ${d.day}`} />
          <ClockCell value={d.highTimeNy} onChange={(highTimeNy) => setDay(d.day, { highTimeNy })} testId={`high-time-${d.day}`} />
          <NumberField value={d.low} decimals={dec} onChange={(low) => setDay(d.day, { low })} aria-label={`Low ${d.day}`} />
          <ClockCell value={d.lowTimeNy} onChange={(lowTimeNy) => setDay(d.day, { lowTimeNy })} testId={`low-time-${d.day}`} />
          <span className="flex justify-center">
            <input type="radio" name={`wh-${section.pair}`} checked={section.weekHighDay === d.day} onChange={() => onChange((p) => ({ ...p, weekHighDay: d.day }))} className="accent-[#e8a33d]" aria-label={`High tygodnia ${d.day}`} data-testid={`week-high-${d.day}`} />
          </span>
          <span className="flex justify-center">
            <input type="radio" name={`wl-${section.pair}`} checked={section.weekLowDay === d.day} onChange={() => onChange((p) => ({ ...p, weekLowDay: d.day }))} className="accent-[#e8a33d]" aria-label={`Low tygodnia ${d.day}`} data-testid={`week-low-${d.day}`} />
          </span>
        </div>
      ))}
      <div className="mt-2 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <span className="text-muted">High tygodnia: </span>
          <span className="text-fg-strong">{section.weekHighDay ? DAY_LABEL[section.weekHighDay] : '—'}</span>
          <span className="ml-3 text-muted">Low tygodnia: </span>
          <span className="text-fg-strong">{section.weekLowDay ? DAY_LABEL[section.weekLowDay] : '—'}</span>
        </div>
        <div className="text-muted">
          High dnia: <span className="text-fg">{tally(hours('highTimeNy'))}</span> · Low dnia: <span className="text-fg">{tally(hours('lowTimeNy'))}</span>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-dim">{WEEKDAYS.length} dni handlowych (pon–pt, data NY). CSV: TradingView → menu wykresu → Export chart data…</div>
    </Section>
  )
}

function WeekTrades({ dates }: { dates: string[] }) {
  const rows = useTradeRows().filter((r) => dates.includes(r.m.tradingDate))
  const be = useJournal((s) => s.journal?.settings.stats.breakevenThresholdR ?? 0.1)
  const closed = rows.filter((r) => r.m.countsInStats)
  const s = summarize(closed.map((r) => ({ r: r.m.resultR as number, time: r.trade.entryTime })), be)
  const rated = closed.filter((r) => r.v.compliant != null)
  return (
    <Section title={`Transakcje tygodnia (${rows.length})`}>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <span>
          Σ R <span className={cx('num', toneClass[tone(s.totalR, be)])}>{fmtR(s.totalR, 1)}</span>
        </span>
        <span>
          WR <span className="num text-fg-strong">{fmtPercent(s.winRate)}</span>
        </span>
        <span>
          E <span className={cx('num', toneClass[tone(s.expectancy)])}>{fmtR(s.expectancy)}</span>
        </span>
        <span>
          zgodne <span className="num text-fg-strong">{rated.length ? `${rated.filter((r) => r.v.compliant).length}/${rated.length}` : '—'}</span>
        </span>
      </div>
      {dates.map((d, i) => {
        const dayRows = rows.filter((r) => r.m.tradingDate === d)
        const total = dayRows.filter((r) => r.m.countsInStats).reduce((a, r) => a + (r.m.resultR ?? 0), 0)
        return (
          <button key={d} className="grid w-full grid-cols-[46px_1fr_70px] items-center gap-2 border-b border-line/50 py-1 text-left text-[12px] last:border-b-0 hover:bg-hover" onClick={() => navigate({ page: 'day', date: d })}>
            <span className="text-muted">{Object.values(DAY_LABEL)[i]}</span>
            <span className="truncate text-muted">
              {dayRows.length ? dayRows.map((r) => `${r.trade.pair} ${r.trade.status === 'missed' ? 'missed' : fmtR(r.m.resultR, 1)}`).join(' · ') : '—'}
            </span>
            <span className={cx('num text-right', toneClass[tone(total, be)])}>{dayRows.length ? fmtR(total, 1) : ''}</span>
          </button>
        )
      })}
      {rows.some((r) => r.v.compliant === false) && (
        <div className="mt-2">
          <Badge tone="warn">łamanie zasad w tym tygodniu</Badge>
        </div>
      )}
    </Section>
  )
}
