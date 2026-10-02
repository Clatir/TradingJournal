import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import { createDayPlan } from '@shared/defaults'
import { newId } from '@shared/ids'
import { formatClock, fromLocal, tradingDateNy } from '@shared/calc/time'
import { BIAS_TIMEFRAMES, type BiasDirection, type DayPair, type DayPlan, type NewsItem, type ScreenRef } from '@shared/schema'
import { fmtR, parseClockInput, parseDateInput, tone, toneClass } from '../../lib/format'
import { useDayPlan, useTradeRows } from '../../store/derived'
import { addRecord, discardDraft, updateRecord, useJournal } from '../../store/journal'
import { navigate } from '../../store/ui'
import { IconBack, IconClose, IconNext, IconPlus } from '../../components/icons'
import { Badge, NumberField, Panel, Segmented, TextArea, TextField, cx } from '../../components/ui'
import { ScreensPanel } from '../screens/ScreensPanel'
import { copyDayMarkdown } from '../export/markdownActions'

export function todayNy(): string {
  return tradingDateNy(new Date().toISOString())
}

/** Move by trading days (Mon–Fri). */
export function shiftTradingDay(date: string, delta: number): string {
  let d = DateTime.fromISO(date, { zone: 'utc' })
  const step = delta > 0 ? 1 : -1
  let left = Math.abs(delta)
  while (left > 0) {
    d = d.plus({ days: step })
    if (d.weekday <= 5) left--
  }
  return d.toISODate() ?? date
}

const BIAS_OPTIONS: Array<{ value: BiasDirection; label: string }> = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'neutral', label: 'Neutral' }
]

export function DayPlanPage({ date }: { date: string }) {
  const entry = useDayPlan(date)
  const journal = useJournal((s) => s.journal)
  const days = useJournal((s) => s.days)
  const isDraft = useJournal((s) => (entry ? !!s.drafts[entry.record.id] : false))
  const readOnly = useJournal((s) => s.status?.readOnly ?? false) || !!entry?.readOnly
  const [activePair, setActivePair] = useState<string | null>(null)

  // Show an editable (draft) plan right away; it is written to disk on the first change.
  useEffect(() => {
    if (entry || !journal || readOnly) return
    const previous = Object.values(days)
      .map((e) => e.record)
      .filter((d) => d.date < date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    const pairs = previous?.pairs.map((p) => p.pair) ?? ['EURUSD']
    const plan = createDayPlan(date, pairs.length ? pairs : ['EURUSD'], journal.settings.contextInstruments)
    addRecord('days', plan, { draft: true })
  }, [entry, journal, date, days, readOnly])

  const id = entry?.record.id
  useEffect(() => () => {
    if (id) discardDraft('days', id)
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      navigate({ page: 'day', date: shiftTradingDay(date, e.key === 'ArrowLeft' ? -1 : 1) })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [date])

  if (!journal) return null
  const plan = entry?.record ?? null
  const up = (fn: (d: DayPlan) => DayPlan) => id && updateRecord('days', id, fn)
  const pairNames = plan?.pairs.map((p) => p.pair) ?? []
  const selected = plan?.pairs.find((p) => p.pair === activePair) ?? plan?.pairs[0] ?? null
  const setPair = (pair: string, fn: (p: DayPair) => DayPair) => up((d) => ({ ...d, pairs: d.pairs.map((p) => (p.pair === pair ? fn(p) : p)) }))

  const previousPlan = Object.values(days)
    .map((e) => e.record)
    .filter((d) => d.date < date && d.id !== id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]

  const copyFromPrevious = () => {
    if (!previousPlan) return
    up((d) => ({
      ...d,
      pairs: previousPlan.pairs.map((p) => ({
        ...p,
        bias: { ...p.bias, H4: { direction: null, reason: '' }, H1: { direction: null, reason: '' } },
        scenarioPrimary: '',
        scenarioAlternative: '',
        screens: []
      }))
    }))
  }

  const weekday = DateTime.fromISO(date).setLocale('pl').toFormat('cccc')

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="day-plan">
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <button className="btn btn-ghost px-1.5" title="Poprzedni dzień handlowy (Alt+←)" onClick={() => navigate({ page: 'day', date: shiftTradingDay(date, -1) })}>
          <IconBack />
        </button>
        <DateInput date={date} />
        <button className="btn btn-ghost px-1.5" title="Następny dzień handlowy (Alt+→)" onClick={() => navigate({ page: 'day', date: shiftTradingDay(date, 1) })}>
          <IconNext />
        </button>
        <span className="text-muted">{weekday}</span>
        {date !== todayNy() && (
          <button className="btn h-[22px]" onClick={() => navigate({ page: 'day', date: todayNy() })}>
            Dziś
          </button>
        )}
        {isDraft && <Badge title="Plan zapisze się przy pierwszej zmianie">nowy plan</Badge>}
        {isDraft && previousPlan && (
          <button className="btn h-[22px]" onClick={copyFromPrevious} title="Pary, bias W/D, DOL i poziomy z poprzedniego planu">
            Kopiuj z {previousPlan.date}
          </button>
        )}
        {plan && !isDraft && (
          <button className="btn h-[22px]" onClick={(e) => void copyDayMarkdown(date, e.shiftKey)} title="Kopiuj markdown (Ctrl+Shift+M); Shift+klik – zapisz .md">
            MD
          </button>
        )}
        <DayStrip date={date} />
      </div>

      {!plan ? (
        <div className="p-6 text-muted">{readOnly ? 'Brak planu na ten dzień (folder tylko do odczytu).' : 'Tworzenie planu…'}</div>
      ) : (
        <fieldset disabled={readOnly} className="grid min-h-0 flex-1 grid-cols-[minmax(420px,1.25fr)_minmax(340px,1fr)_minmax(340px,0.95fr)]">
          {/* ------------------------------------------- pairs */}
          <div className="flex min-h-0 flex-col overflow-y-auto border-r border-line">
            <div className="flex h-[32px] shrink-0 items-center gap-1 border-b border-line px-2">
              {pairNames.map((p) => (
                <span key={p} className="flex items-center">
                  <button
                    className={cx('chip num', selected?.pair === p && 'border-accent/60 text-accent')}
                    aria-pressed={selected?.pair === p}
                    onClick={() => setActivePair(p)}
                    data-testid={`day-pair-${p}`}
                  >
                    {p}
                  </button>
                  {pairNames.length > 1 && selected?.pair === p && (
                    <button
                      className="ml-0.5 text-dim hover:text-down"
                      title="Usuń parę z planu"
                      onClick={() => {
                        up((d) => ({ ...d, pairs: d.pairs.filter((x) => x.pair !== p) }))
                        setActivePair(null)
                      }}
                    >
                      <IconClose size={11} />
                    </button>
                  )}
                </span>
              ))}
              <select
                className="input ml-1 h-[22px] w-[110px] px-1 text-[11.5px]"
                value=""
                aria-label="Dodaj parę"
                onChange={(e) => {
                  const pair = e.currentTarget.value
                  if (!pair) return
                  up((d) => ({ ...d, pairs: [...d.pairs, { pair, bias: emptyBias(), drawOnLiquidity: '', keyLevels: [], scenarioPrimary: '', scenarioAlternative: '', screens: [] }] }))
                  setActivePair(pair)
                }}
              >
                <option value="">+ para…</option>
                {journal.settings.pairs
                  .filter((p) => !p.archived && !pairNames.includes(p.symbol))
                  .map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.symbol}
                    </option>
                  ))}
              </select>
            </div>
            {selected && <PairSection key={selected.pair} section={selected} date={date} onChange={(fn) => setPair(selected.pair, fn)} readOnly={readOnly} />}
          </div>

          {/* ------------------------------------------- context, news, review */}
          <div className="flex min-h-0 flex-col overflow-y-auto border-r border-line">
            <Section title="Kontekst międzyrynkowy">
              <div className="flex flex-col gap-1">
                {mergedInstruments(plan, journal.settings.contextInstruments).map((row) => (
                  <div key={row.instrument} className="grid grid-cols-[62px_auto_minmax(0,1fr)] items-center gap-1.5">
                    <span className="num text-fg-strong">{row.instrument}</span>
                    <Segmented
                      size="sm"
                      value={row.relation}
                      onChange={(relation) =>
                        up((d) => ({ ...d, intermarket: upsertBy(d.intermarket, 'instrument', row.instrument, { relation }) }))
                      }
                      options={[
                        { value: 'confirms', label: 'Zgodny', title: 'Potwierdza bias' },
                        { value: 'diverges', label: 'Dywerg.', title: 'Dywergencja (SMT)' },
                        { value: 'neutral', label: '—', title: 'Bez sygnału' }
                      ]}
                    />
                    <input
                      className="input"
                      placeholder="odczyt…"
                      value={row.read}
                      onChange={(e) => {
                        const read = e.currentTarget.value
                        up((d) => ({ ...d, intermarket: upsertBy(d.intermarket, 'instrument', row.instrument, { read }) }))
                      }}
                    />
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title="Newsy high-impact (EUR / USD)"
              actions={
                <button
                  className="btn h-[20px] px-1.5 text-[11px]"
                  onClick={() => {
                    const t = fromLocal(date, '08:30', 'NY')
                    if (t) up((d) => ({ ...d, news: [...d.news, { id: newId(), time: t.iso, currency: 'USD', title: '', impact: 'high' }] }))
                  }}
                  data-testid="add-news"
                >
                  <IconPlus size={11} /> news
                </button>
              }
            >
              {plan.news.length === 0 && <span className="text-[11.5px] text-dim">Brak danych high-impact w tym dniu.</span>}
              <div className="flex flex-col gap-1">
                {[...plan.news]
                  .sort((a, b) => (a.time < b.time ? -1 : 1))
                  .map((n) => (
                    <NewsRow
                      key={n.id}
                      item={n}
                      date={date}
                      onChange={(patch) => up((d) => ({ ...d, news: d.news.map((x) => (x.id === n.id ? { ...x, ...patch } : x)) }))}
                      onRemove={() => up((d) => ({ ...d, news: d.news.filter((x) => x.id !== n.id) }))}
                    />
                  ))}
              </div>
            </Section>

            <Section title="Po sesji – co się wydarzyło wobec planu" className="flex-1">
              <div className="flex flex-col gap-2">
                <Segmented
                  value={plan.review.vsPlan}
                  onChange={(vsPlan) => up((d) => ({ ...d, review: { ...d.review, vsPlan } }))}
                  options={[
                    { value: 'matched', label: 'Zgodnie z planem' },
                    { value: 'partial', label: 'Częściowo' },
                    { value: 'missed', label: 'Inaczej niż plan' }
                  ]}
                />
                <TextArea
                  value={plan.review.whatHappened}
                  onChange={(whatHappened) => up((d) => ({ ...d, review: { ...d.review, whatHappened } }))}
                  rows={4}
                  placeholder="Co zrobiła cena: który scenariusz się zrealizował, gdzie był high/low dnia, reakcja na PD arrays"
                  data-testid="day-review"
                />
                <TextArea value={plan.review.notes} onChange={(notes) => up((d) => ({ ...d, review: { ...d.review, notes } }))} rows={2} placeholder="Wnioski na jutro" />
              </div>
            </Section>
          </div>

          {/* ------------------------------------------- trades & screens */}
          <div className="flex min-h-0 flex-col overflow-y-auto">
            <DayTrades date={date} />
            <Section title={`Screeny dnia (${plan.screens.length})`}>
              <ScreensPanel
                screens={plan.screens}
                onChange={(fn: (s: ScreenRef[]) => ScreenRef[]) => up((d) => ({ ...d, screens: fn(d.screens) }))}
                date={date}
                withPhases={false}
                labelPrefix="dzien"
                readOnly={readOnly}
              />
            </Section>
          </div>
        </fieldset>
      )}
    </div>
  )
}

function emptyBias(): DayPair['bias'] {
  return { W: { direction: null, reason: '' }, D: { direction: null, reason: '' }, H4: { direction: null, reason: '' }, H1: { direction: null, reason: '' } }
}

function mergedInstruments(plan: DayPlan, instruments: string[]): DayPlan['intermarket'] {
  const rows = [...plan.intermarket]
  for (const i of instruments) if (!rows.some((r) => r.instrument === i)) rows.push({ instrument: i, read: '', relation: null })
  return rows
}

function upsertBy<T extends Record<string, unknown>>(rows: T[], key: keyof T, value: unknown, patch: Partial<T>): T[] {
  return rows.some((r) => r[key] === value)
    ? rows.map((r) => (r[key] === value ? { ...r, ...patch } : r))
    : [...rows, { [key]: value, read: '', relation: null, ...patch } as unknown as T]
}

function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Panel title={title} actions={actions} className={cx('border-0 border-b', className)}>
      {children}
    </Panel>
  )
}

function PairSection({ section, date, onChange, readOnly }: { section: DayPair; date: string; onChange: (fn: (p: DayPair) => DayPair) => void; readOnly: boolean }) {
  const pairCfg = useJournal((s) => s.journal?.settings.pairs.find((p) => p.symbol === section.pair))
  const decimals = pairCfg?.priceDecimals ?? 5
  return (
    <>
      <Section title={`Bias ${section.pair}`}>
        <div className="flex flex-col gap-1">
          {BIAS_TIMEFRAMES.map((tf) => (
            <div key={tf} className="grid grid-cols-[30px_auto_minmax(0,1fr)] items-center gap-1.5">
              <span className="num text-[12px] font-medium text-fg-strong">{tf}</span>
              <Segmented
                size="sm"
                value={section.bias[tf].direction}
                onChange={(direction) => onChange((p) => ({ ...p, bias: { ...p.bias, [tf]: { ...p.bias[tf], direction: p.bias[tf].direction === direction ? null : direction } } }))}
                options={BIAS_OPTIONS}
                aria-label={`Bias ${tf}`}
              />
              <input
                className="input"
                placeholder="uzasadnienie…"
                value={section.bias[tf].reason}
                onChange={(e) => {
                  const reason = e.currentTarget.value
                  onChange((p) => ({ ...p, bias: { ...p.bias, [tf]: { ...p.bias[tf], reason } } }))
                }}
                data-testid={`bias-reason-${tf}`}
              />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Draw on liquidity">
        <TextArea value={section.drawOnLiquidity} onChange={(drawOnLiquidity) => onChange((p) => ({ ...p, drawOnLiquidity }))} rows={2} placeholder="np. PDH 1.0874 / EQH nad Asią" />
      </Section>
      <Section
        title="Kluczowe poziomy"
        actions={
          <button className="btn h-[20px] px-1.5 text-[11px]" onClick={() => onChange((p) => ({ ...p, keyLevels: [...p.keyLevels, { id: newId(), price: null, label: '' }] }))}>
            <IconPlus size={11} /> poziom
          </button>
        }
      >
        {section.keyLevels.length === 0 && <span className="text-[11.5px] text-dim">PDH/PDL, PWH/PWL, FVG HTF, EQH/EQL…</span>}
        <div className="flex flex-col gap-1">
          {section.keyLevels.map((l) => (
            <div key={l.id} className="grid grid-cols-[110px_minmax(0,1fr)_18px] items-center gap-1.5">
              <NumberField
                value={l.price}
                decimals={decimals}
                step={pairCfg?.pipSize ?? 0.0001}
                onChange={(price) => onChange((p) => ({ ...p, keyLevels: p.keyLevels.map((x) => (x.id === l.id ? { ...x, price } : x)) }))}
                aria-label="Cena poziomu"
              />
              <TextField value={l.label} placeholder="np. PDH, H4 FVG" onChange={(label) => onChange((p) => ({ ...p, keyLevels: p.keyLevels.map((x) => (x.id === l.id ? { ...x, label } : x)) }))} />
              <button className="text-dim hover:text-down" onClick={() => onChange((p) => ({ ...p, keyLevels: p.keyLevels.filter((x) => x.id !== l.id) }))} aria-label="Usuń poziom">
                <IconClose size={12} />
              </button>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Scenariusze">
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-muted">Główny</span>
          <TextArea value={section.scenarioPrimary} onChange={(scenarioPrimary) => onChange((p) => ({ ...p, scenarioPrimary }))} rows={3} placeholder="Jeśli London zbierze Asia low → MSS na M15 → long z FVG do PDH" data-testid="scenario-primary" />
          <span className="text-[11.5px] text-muted">Alternatywny</span>
          <TextArea value={section.scenarioAlternative} onChange={(scenarioAlternative) => onChange((p) => ({ ...p, scenarioAlternative }))} rows={2} placeholder="Jeśli cena zamknie H1 pod …" />
        </div>
      </Section>
      <Section title={`Screeny ${section.pair} (${section.screens.length})`}>
        <ScreensPanel
          screens={section.screens}
          onChange={(fn: (s: ScreenRef[]) => ScreenRef[]) => onChange((p) => ({ ...p, screens: fn(p.screens) }))}
          date={date}
          withPhases={false}
          capturePaste={!readOnly}
          readOnly={readOnly}
          labelPrefix={`plan-${section.pair}`}
        />
      </Section>
    </>
  )
}

function NewsRow({ item, date, onChange, onRemove }: { item: NewsItem; date: string; onChange: (p: Partial<NewsItem>) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const c = parseClockInput(draft)
    const res = c ? fromLocal(date, c, 'NY') : null
    if (res) onChange({ time: res.iso })
    setDraft(null)
  }
  return (
    <div className="grid grid-cols-[56px_auto_minmax(0,1fr)_18px] items-center gap-1.5" data-testid="news-row">
      <input
        className="input num px-1 text-center"
        value={draft ?? formatClock(item.time, 'NY')}
        title={`NY · WAW ${formatClock(item.time, 'WAW')}`}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label="Godzina NY"
      />
      <Segmented
        size="sm"
        value={item.currency === 'EUR' ? 'EUR' : 'USD'}
        onChange={(currency) => onChange({ currency })}
        options={[
          { value: 'USD', label: 'USD' },
          { value: 'EUR', label: 'EUR' }
        ]}
      />
      <input className="input" placeholder="np. CPI, NFP, FOMC" value={item.title} onChange={(e) => onChange({ title: e.currentTarget.value })} data-testid="news-title" />
      <button className="text-dim hover:text-down" onClick={onRemove} aria-label="Usuń news">
        <IconClose size={12} />
      </button>
    </div>
  )
}

function DateInput({ date }: { date: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input num w-[104px] text-center"
      value={draft ?? date}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || draft == null) return
        const d = parseDateInput(draft, Number(date.slice(0, 4)))
        if (d) navigate({ page: 'day', date: d })
        setDraft(null)
      }}
      aria-label="Data planu"
      data-testid="day-date"
    />
  )
}

/** Last two weeks of trading days: plan present (accent) and day result. */
function DayStrip({ date }: { date: string }) {
  const days = useJournal((s) => s.days)
  const rows = useTradeRows()
  const be = useJournal((s) => s.journal?.settings.stats.breakevenThresholdR ?? 0.1)
  const items = useMemo(() => {
    const planDates = new Set(Object.values(days).map((e) => e.record.date))
    const out: Array<{ date: string; plan: boolean; r: number | null; n: number }> = []
    let d = shiftTradingDay(todayNy(), 1)
    for (let i = 0; i < 12; i++) {
      d = shiftTradingDay(d, -1)
      const dayRows = rows.filter((r) => r.m.tradingDate === d && r.m.countsInStats)
      out.unshift({ date: d, plan: planDates.has(d), r: dayRows.length ? dayRows.reduce((s, r) => s + (r.m.resultR ?? 0), 0) : null, n: dayRows.length })
    }
    return out
  }, [days, rows])
  return (
    <div className="ml-auto flex items-center gap-px">
      {items.map((it) => (
        <button
          key={it.date}
          onClick={() => navigate({ page: 'day', date: it.date })}
          title={`${it.date}${it.plan ? ' · plan' : ''}${it.n ? ` · ${it.n} tr. ${fmtR(it.r)}` : ''}`}
          className={cx(
            'flex h-[28px] w-[38px] flex-col items-center justify-center border text-[10px]',
            it.date === date ? 'border-accent' : 'border-line hover:border-line-strong'
          )}
        >
          <span className={cx('num', it.plan ? 'text-accent' : 'text-dim')}>{it.date.slice(8)}</span>
          <span className={cx('num text-[9.5px]', toneClass[tone(it.r, be)])}>{it.r != null ? it.r.toFixed(1) : ''}</span>
        </button>
      ))}
    </div>
  )
}

function DayTrades({ date }: { date: string }) {
  const rows = useTradeRows().filter((r) => r.m.tradingDate === date)
  const be = useJournal((s) => s.journal?.settings.stats.breakevenThresholdR ?? 0.1)
  const total = rows.filter((r) => r.m.countsInStats).reduce((s, r) => s + (r.m.resultR ?? 0), 0)
  return (
    <Section
      title={`Transakcje dnia (${rows.length})`}
      actions={rows.length ? <span className={cx('num text-[12px]', toneClass[tone(total, be)])}>{fmtR(total)}</span> : undefined}
    >
      {rows.length === 0 && <span className="text-[11.5px] text-dim">Brak transakcji tego dnia.</span>}
      {[...rows].reverse().map((r) => (
        <button
          key={r.trade.id}
          className="grid w-full grid-cols-[42px_62px_44px_minmax(0,1fr)_58px] items-center gap-1.5 border-b border-line/60 py-1 text-left text-[12px] last:border-b-0 hover:bg-hover"
          onClick={() => navigate({ page: 'trade', id: r.trade.id })}
        >
          <span className="num text-muted">{formatClock(r.trade.entryTime, 'NY')}</span>
          <span className="num text-fg-strong">{r.trade.pair}</span>
          <span>{r.trade.direction === 'long' ? 'Long' : 'Short'}</span>
          <span className={cx('num truncate text-[11px]', r.v.compliant === false ? 'text-accent' : 'text-muted')}>
            {r.v.score == null ? '' : `zgodność ${Math.round(r.v.score * 100)}%`}
          </span>
          <span className={cx('num text-right', r.trade.status === 'missed' ? 'text-dim' : toneClass[tone(r.m.resultR, be)])}>
            {r.trade.status === 'missed' ? 'missed' : fmtR(r.m.resultR)}
          </span>
        </button>
      ))}
    </Section>
  )
}
