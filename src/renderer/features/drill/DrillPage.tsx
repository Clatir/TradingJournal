import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { ANSWER_LABEL, answerCard, drillCandidates, drillStats, pickDrillCards, ratio, scoreCard, tally, type DrillRow, type Tally } from '@shared/calc/drills'
import { tradingDateNy } from '@shared/calc/time'
import { newId } from '@shared/ids'
import { SCHEMA_VERSION, type DrillAnswer, type DrillCard, type DrillSession, type ScreenRef } from '@shared/schema'
import { useTradeRows, type TradeRow } from '../../store/derived'
import { addRecord, discardDraft, updateRecord, useJournal } from '../../store/journal'
import { navigate, openLightbox } from '../../store/ui'
import { ZoomImage } from '../../components/Lightbox'
import { Badge, Cell, Kbd, NumberField, Panel, Segmented, Toggle, cx } from '../../components/ui'
import { fmtNum, fmtPercent, fmtR, toneClass, tone } from '../../lib/format'

interface DrillUi {
  pair: string
  minAge: '0' | '7' | '30'
  count: '5' | '10' | '20'
  /** Card index whose answer is being shown (reveal), cleared by "Dalej". */
  revealed: { sessionId: string; index: number } | null
  /** Session whose summary is shown after the last card. */
  summary: string | null
  annotations: boolean
}

// All trades by default: an age filter on by default hid fresh trades without saying why.
const useDrillUi = create<DrillUi>(() => ({ pair: '', minAge: '0', count: '10', revealed: null, summary: null, annotations: false }))
const setUi = (patch: Partial<DrillUi>) => useDrillUi.setState(patch)

/** Pips without a sign (a distance, not a result). */
const pipsText = (v: number) => fmtNum(v, 1)
const pct = (ok: number, n: number) => (n ? fmtPercent(ok / n, 0) : '—')

function activeDrill(drills: Record<string, { record: DrillSession }>): DrillSession | null {
  const open = Object.values(drills)
    .map((e) => e.record)
    .filter((s) => s.finishedAt == null && s.cards.some((c) => c.answer == null))
  return open.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] ?? null
}

function startDrill(rows: readonly DrillRow[], sessions: readonly DrillSession[], machine: string | null): boolean {
  const ui = useDrillUi.getState()
  const now = new Date().toISOString()
  const ids = pickDrillCards(rows, sessions, {
    count: Number(ui.count),
    pair: ui.pair || null,
    minAgeDays: Number(ui.minAge),
    today: tradingDateNy(now),
    random: Math.random
  })
  if (!ids.length) return false
  const byId = new Map(rows.map((r) => [r.trade.id, r]))
  const session: DrillSession = {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    machine,
    finishedAt: null,
    cards: ids.map((tradeId) => ({ tradeId, pair: byId.get(tradeId)?.trade.pair ?? '', answer: null, slPips: null, answeredAt: null, truth: null }))
  }
  // A draft until the first answer: an abandoned, unanswered session never reaches the disk.
  addRecord('drills', session, { draft: true })
  setUi({ revealed: null, summary: null })
  return true
}

function finish(id: string): void {
  updateRecord('drills', id, (s) => ({ ...s, finishedAt: s.finishedAt ?? new Date().toISOString() }))
  setUi({ revealed: null, summary: id })
}

/** "Trening": the "before" screen of a past trade, your call, then the reveal; accuracy over time. */
export function DrillPage() {
  const drills = useJournal((s) => s.drills)
  const drafts = useJournal((s) => s.drafts)
  const rows = useTradeRows()
  const ui = useDrillUi()
  const active = activeDrill(drills)
  const revealedSession = ui.revealed ? (drills[ui.revealed.sessionId]?.record ?? null) : null
  const summary = ui.summary ? (drills[ui.summary]?.record ?? null) : null

  // Leaving the page drops an untouched (draft) session.
  useEffect(() => () => {
    const a = activeDrill(useJournal.getState().drills)
    if (a && useJournal.getState().drafts[a.id]) discardDraft('drills', a.id)
  }, [])

  let body
  if (revealedSession && ui.revealed) body = <CardView session={revealedSession} index={ui.revealed.index} rows={rows} />
  else if (active) {
    const index = active.cards.findIndex((c) => c.answer == null)
    body = <CardView session={active} index={index} rows={rows} />
  } else if (summary) body = <SessionSummary session={summary} />
  else body = <DrillHome rows={rows} />
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="drill-page" data-draft={active && drafts[active.id] ? '1' : undefined}>
      {body}
    </div>
  )
}

function DrillHome({ rows }: { rows: TradeRow[] }) {
  const drills = useJournal((s) => s.drills)
  const machine = useJournal((s) => s.appInfo?.machineName ?? null)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const ui = useDrillUi()
  const sessions = useMemo(() => Object.values(drills).map((e) => e.record), [drills])
  const today = tradingDateNy(new Date().toISOString())
  const all = useMemo(() => drillCandidates(rows, { pair: null, minAgeDays: 0, today }), [rows, today])
  const available = useMemo(() => drillCandidates(rows, { pair: ui.pair || null, minAgeDays: Number(ui.minAge), today }), [rows, ui.pair, ui.minAge, today])
  const pairs = [...new Set(all.map((r) => r.trade.pair))].sort()
  const byAge = (days: number) => drillCandidates(rows, { pair: ui.pair || null, minAgeDays: days, today }).length
  // Closed (or missed with an outcome) trades that only lack a "before" screen to become cards.
  const noBefore = rows.filter((r) => r.trade.status !== 'open' && r.m.resultR != null && r.m.outcome != null && !r.trade.screens.some((x) => x.phase === 'before')).length
  const stats = useMemo(() => drillStats(sessions), [sessions])
  const recent = [...sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 12)
  const [none, setNone] = useState(false)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-[360px_minmax(0,1fr)] border-b border-line">
        <Panel title="Nowy trening" className="border-0 border-r border-line">
          <div className="flex flex-col gap-2.5 text-[12px]">
            <p className="text-muted">
              Zobaczysz screen „przed” z dawnej transakcji (bez wyniku). Zdecyduj: long, short albo nie wchodzę, opcjonalnie wpisz SL w pipsach – potem odkryjesz, co się stało.
              Najlepiej działa ze screenami sprzed wejścia, bez narysowanej pozycji.
            </p>
            <span className="label">Para</span>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Para treningu">
              {['', ...pairs].map((p) => (
                <button key={p || 'all'} role="radio" aria-checked={ui.pair === p} className={cx('chip', p && 'num')} aria-pressed={ui.pair === p} onClick={() => setUi({ pair: p })}>
                  {p || 'Wszystkie'}
                </button>
              ))}
            </div>
            <span className="label">Transakcje</span>
            <Segmented
              size="sm"
              value={ui.minAge}
              onChange={(minAge) => setUi({ minAge })}
              options={[
                { value: '0', label: `wszystkie (${byAge(0)})` },
                { value: '7', label: `starsze niż 7 dni (${byAge(7)})` },
                { value: '30', label: `starsze niż 30 dni (${byAge(30)})` }
              ]}
              aria-label="Wiek transakcji"
              className="self-start"
            />
            <span className="label">Liczba kart</span>
            <Segmented
              size="sm"
              value={ui.count}
              onChange={(count) => setUi({ count })}
              options={[
                { value: '5', label: '5' },
                { value: '10', label: '10' },
                { value: '20', label: '20' }
              ]}
              aria-label="Liczba kart"
              className="self-start"
            />
            <div className="flex items-center gap-2">
              <span className="text-muted" data-testid="drill-available">
                Dostępne karty: <b className="num text-fg-strong">{available.length}</b>
              </span>
              <button
                className="btn btn-accent ml-auto"
                disabled={readOnly || available.length === 0}
                onClick={() => setNone(!startDrill(rows, sessions, machine))}
                data-testid="drill-start"
              >
                Start
              </button>
            </div>
            {available.length === 0 && byAge(0) > 0 && (
              <p className="text-[11.5px] text-accent" data-testid="drill-age-hint">
                {byAge(0)} {byAge(0) === 1 ? 'karta jest nowsza' : 'kart jest nowszych'} niż {ui.minAge} dni – starsze odkładasz, żeby nie pamiętać wyniku.{' '}
                <button className="underline" onClick={() => setUi({ minAge: '0' })}>
                  Pokaż wszystkie
                </button>
              </p>
            )}
            {noBefore > 0 && (
              <p className="text-[11.5px] text-dim" data-testid="drill-no-before">
                {noBefore} {noBefore === 1 ? 'transakcja ma' : 'transakcji ma'} wynik, ale bez screena w fazie „przed” – dodaj go w edytorze (Screeny → Przed), a stanie się kartą.
              </p>
            )}
            {(available.length === 0 || none) && (
              <p className="text-[11.5px] text-dim">
                Karta to zamknięta transakcja (albo missed z wynikiem hipotetycznym) ze screenem w fazie „przed”. Kolejność: najpierw nigdy nie ćwiczone, potem te z błędną
                odpowiedzią, potem najdawniej powtarzane.
              </p>
            )}
          </div>
        </Panel>
        <Panel title="Trafność" className="border-0">
          {stats.total.answered === 0 ? (
            <div className="py-6 text-center text-[12px] text-dim">Jeszcze bez odpowiedzi.</div>
          ) : (
            <div className="flex flex-col gap-3 text-[12px]">
              <div className="grid grid-cols-5 border border-line" data-testid="drill-kpis">
                <Cell className="border-r border-line" label="Odpowiedzi" value={stats.total.answered} sub={`${stats.tradesSeen} transakcji`} />
                <Cell className="border-r border-line" label="Decyzja" value={pct(stats.total.decisionOk, stats.total.decisionN)} sub={`${stats.total.decisionOk} / ${stats.total.decisionN}`} />
                <Cell className="border-r border-line" label="Kierunek" value={pct(stats.total.directionOk, stats.total.directionN)} sub={`${stats.total.directionOk} / ${stats.total.directionN}`} />
                <Cell
                  className="border-r border-line"
                  label="Błąd SL"
                  value={stats.total.slN ? `${pipsText(stats.total.slErrorSum / stats.total.slN)} p` : '—'}
                  sub={stats.total.slN ? `blisko: ${pct(stats.total.slClose, stats.total.slN)}` : 'bez wpisanych SL'}
                />
                <Cell className="" label="Ocena" value={stats.months.length ? trend(stats.months.map((m) => m.tally)) : '—'} sub="ostatni miesiąc vs wcześniej" />
              </div>
              <TallyTable title="Miesiąc" rows={stats.months.map((m) => ({ key: m.month, label: m.month, tally: m.tally }))} testId="drill-months" />
              <TallyTable title="Para" rows={stats.pairs.map((p) => ({ key: p.pair, label: p.pair, tally: p.tally }))} testId="drill-pairs" />
              <p className="text-[11.5px] text-dim">
                Decyzja: transakcję zyskowną trzeba wziąć w jej kierunku, stratną – odpuścić; BE nie jest oceniany. Kierunek: czy dobrze odczytany, gdy wchodzisz. SL „blisko” = w
                granicach 2 pipsów albo 25% rzeczywistego SL.
              </p>
            </div>
          )}
        </Panel>
      </div>
      {recent.length > 0 && (
        <Panel title="Ostatnie treningi" className="border-0">
          <div className="flex flex-col text-[12px]" data-testid="drill-sessions">
            {recent.map((s) => {
              const t = tally(s.cards)
              return (
                <button
                  key={s.id}
                  className="grid grid-cols-[150px_120px_160px_minmax(0,1fr)] items-center gap-2 border-b border-line/60 px-1 py-1 text-left last:border-b-0 hover:bg-hover"
                  onClick={() => setUi({ summary: s.id })}
                >
                  <span className="num text-muted">{s.startedAt.slice(0, 16).replace('T', ' ')}</span>
                  <span className="num">
                    {t.answered} / {s.cards.length} kart
                  </span>
                  <span className="num">decyzja {pct(t.decisionOk, t.decisionN)}</span>
                  <span className="truncate text-muted">{s.machine ?? ''}</span>
                </button>
              )
            })}
          </div>
        </Panel>
      )}
    </div>
  )
}

function trend(months: Tally[]): string {
  const last = months.at(-1)!
  const before = months.slice(0, -1).reduce<Tally | null>(
    (acc, t) =>
      acc
        ? { ...acc, decisionN: acc.decisionN + t.decisionN, decisionOk: acc.decisionOk + t.decisionOk }
        : { ...t },
    null
  )
  const a = ratio(last.decisionOk, last.decisionN)
  const b = before ? ratio(before.decisionOk, before.decisionN) : null
  if (a == null) return '—'
  if (b == null) return fmtPercent(a, 0)
  const d = Math.round((a - b) * 100)
  return `${fmtPercent(a, 0)} (${d >= 0 ? '+' : '−'}${Math.abs(d)} pp)`
}

function TallyTable({ title, rows, testId }: { title: string; rows: Array<{ key: string; label: string; tally: Tally }>; testId: string }) {
  if (!rows.length) return null
  return (
    <div className="border border-line" data-testid={testId}>
      <div className="grid grid-cols-[90px_70px_minmax(0,1fr)_70px_70px] gap-2 border-b border-line bg-raised px-2 py-1 text-[10.5px] tracking-wide text-muted uppercase">
        <span>{title}</span>
        <span className="text-right">karty</span>
        <span>decyzja</span>
        <span className="text-right">kierunek</span>
        <span className="text-right">błąd SL</span>
      </div>
      {rows.map((r) => {
        const d = ratio(r.tally.decisionOk, r.tally.decisionN)
        return (
          <div key={r.key} className="grid grid-cols-[90px_70px_minmax(0,1fr)_70px_70px] items-center gap-2 border-b border-line/60 px-2 py-1 last:border-b-0">
            <span className="num">{r.label}</span>
            <span className="num text-right">{r.tally.answered}</span>
            <span className="flex items-center gap-2">
              <span className="num w-[38px] text-right">{d == null ? '—' : fmtPercent(d, 0)}</span>
              <span className="h-[6px] flex-1 bg-raised">
                <span className="block h-full bg-accent" style={{ width: `${Math.round((d ?? 0) * 100)}%` }} />
              </span>
            </span>
            <span className="num text-right">{pct(r.tally.directionOk, r.tally.directionN)}</span>
            <span className="num text-right">{r.tally.slN ? pipsText(r.tally.slErrorSum / r.tally.slN) : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

const ANSWERS: DrillAnswer[] = ['long', 'short', 'skip']
const ANSWER_KEY: Record<DrillAnswer, string> = { long: 'L', short: 'S', skip: 'N' }

function CardView({ session, index, rows }: { session: DrillSession; index: number; rows: TradeRow[] }) {
  const card = session.cards[index]
  const row = rows.find((r) => r.trade.id === card?.tradeId) ?? null
  const ui = useDrillUi()
  const dictionaries = useJournal((s) => s.journal?.dictionaries)
  const [slGuess, setSlGuess] = useState<number | null>(null)
  const [screenIdx, setScreenIdx] = useState(0)
  const [view, setView] = useState<Parameters<typeof ZoomImage>[0]['view']>(null)
  const answered = card?.answer != null
  const before = useMemo(() => row?.trade.screens.filter((s) => s.phase === 'before') ?? [], [row])
  const screens: ScreenRef[] = answered ? (row?.trade.screens ?? []) : before

  useEffect(() => {
    setSlGuess(null)
    setView(null)
    // After the reveal start on the first "after" screen, if any.
    const after = answered ? (row?.trade.screens.findIndex((s) => s.phase === 'after') ?? -1) : -1
    setScreenIdx(after >= 0 ? after : 0)
  }, [session.id, index, answered, row])

  const answer = (a: DrillAnswer) => {
    if (!card || answered) return
    updateRecord('drills', session.id, (s) => ({ ...s, cards: s.cards.map((c, i) => (i === index ? answerCard(c, a, slGuess, row, new Date().toISOString()) : c)) }))
    setUi({ revealed: { sessionId: session.id, index } })
  }
  const next = () => {
    const more = session.cards.some((c, i) => i !== index && c.answer == null)
    if (more) setUi({ revealed: null })
    else finish(session.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (!answered) {
        if (typing) return
        const a = ANSWERS.find((x) => ANSWER_KEY[x].toLowerCase() === e.key.toLowerCase())
        if (a) {
          e.preventDefault()
          answer(a)
        }
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!card) return null
  const score = scoreCard(card)
  const shown = screens[Math.min(screenIdx, screens.length - 1)]
  const name = (key: 'entryModels' | 'pdArrays', id: string | null) => (id ? (dictionaries?.[key].find((x) => x.id === id)?.name ?? '?') : null)
  return (
    <div className="flex min-h-0 flex-1" data-testid="drill-card">
      <div className="flex min-w-0 flex-1 flex-col border-r border-line">
        <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-line px-2.5 text-[12px]">
          <span className="num text-muted" data-testid="drill-progress">
            Karta {index + 1} / {session.cards.length}
          </span>
          <span className="num text-[13px] text-fg-strong">{card.pair}</span>
          {screens.map((s, i) => (
            <button key={s.id} className="chip" aria-pressed={i === screenIdx} onClick={() => setScreenIdx(i)}>
              {[s.phase === 'before' ? 'przed' : s.phase === 'after' ? 'po' : s.phase === 'during' ? 'w trakcie' : null, s.timeframe].filter(Boolean).join(' · ') || `screen ${i + 1}`}
            </button>
          ))}
          <span className="ml-auto text-muted">
            <Toggle checked={ui.annotations || answered} onChange={(v) => setUi({ annotations: v })} disabled={answered} label="adnotacje" />
          </span>
          <button className="btn btn-ghost h-[22px]" onClick={() => finish(session.id)} title="Zakończ trening; karty bez odpowiedzi się nie liczą" data-testid="drill-stop">
            Zakończ
          </button>
        </div>
        <div className="flex min-h-0 flex-1 bg-bg">
          {shown ? (
            <ZoomImage screen={ui.annotations || answered ? shown : { ...shown, annotations: [] }} view={view} onView={setView} />
          ) : (
            <div className="m-auto text-[12px] text-dim">{row ? 'Brak screenu „przed”.' : 'Transakcja została usunięta – pomiń kartę.'}</div>
          )}
        </div>
      </div>
      <div className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto p-3 text-[12px]">
        {!answered ? (
          <>
            <span className="label">Co robisz?</span>
            {row?.m.killzoneNames.length ? <span className="text-muted">Sesja: {row.m.killzoneNames.join(', ')}</span> : null}
            <label className="flex items-center gap-2">
              <span className="text-muted">Twój SL (pips, opcjonalnie)</span>
              <NumberField className="ml-auto w-[70px]" value={slGuess} onChange={setSlGuess} isValid={(v) => v == null || v > 0} aria-label="Twój SL w pipsach" data-testid="drill-sl" />
            </label>
            <div className="flex flex-col gap-1.5">
              {ANSWERS.map((a) => (
                <button key={a} className="btn h-[30px] justify-between" onClick={() => answer(a)} data-testid={`drill-answer-${a}`}>
                  <span>{ANSWER_LABEL[a]}</span>
                  <Kbd>{ANSWER_KEY[a]}</Kbd>
                </button>
              ))}
            </div>
            {!row && (
              <button className="btn btn-ghost" onClick={() => answer('skip')}>
                Pomiń kartę
              </button>
            )}
            <p className="text-[11.5px] text-dim">Wynik, kierunek i screeny „po” pokażą się po odpowiedzi. Kółko myszy – powiększenie, przeciąganie – przesuwanie.</p>
          </>
        ) : (
          <div className="flex flex-col gap-2" data-testid="drill-reveal">
            <span className="label">Twoja odpowiedź</span>
            <span className="text-[13px] text-fg-strong">
              {ANSWER_LABEL[card.answer!]}
              {card.slPips != null ? <span className="num text-muted"> · SL {pipsText(card.slPips)} p</span> : null}
            </span>
            {card.truth ? (
              <>
                <span className="label">Co było naprawdę</span>
                <span className="text-[13px]">
                  <span className="text-fg-strong">{card.truth.direction === 'long' ? 'Long' : 'Short'}</span>
                  {card.truth.status === 'missed' ? <span className="text-muted"> (missed, wynik hipotetyczny)</span> : null}
                  {' · '}
                  <span className={cx('num', toneClass[tone(card.truth.resultR)])} data-testid="drill-result">
                    {fmtR(card.truth.resultR)}
                  </span>
                </span>
                <div className="flex flex-wrap gap-1.5" data-testid="drill-score">
                  <Verdict label="Decyzja" ok={score?.decision ?? null} na="BE – bez oceny" />
                  <Verdict label="Kierunek" ok={score?.direction ?? null} na="nie wchodzisz" />
                  {score?.slError != null && <Verdict label={`SL ±${pipsText(score.slError)} p`} ok={score.slClose} na="" />}
                </div>
                {card.truth.riskPips != null && <span className="num text-muted">Rzeczywisty SL: {pipsText(card.truth.riskPips)} p</span>}
              </>
            ) : (
              <span className="text-muted">Transakcji nie ma już w dzienniku – karta bez oceny.</span>
            )}
            {row && (
              <div className="flex flex-col gap-1 border-t border-line pt-2">
                {name('entryModels', row.trade.entryModelId) && <span>Model: {name('entryModels', row.trade.entryModelId)}</span>}
                {name('pdArrays', row.trade.entryPdArrayId) && <span>PD array: {name('pdArrays', row.trade.entryPdArrayId)}</span>}
                {row.trade.psychology.didWell && <span className="text-muted">Dobrze: {row.trade.psychology.didWell}</span>}
                {row.trade.psychology.nextTime && <span className="text-muted">Następnym razem: {row.trade.psychology.nextTime}</span>}
                <span className="num text-dim">{row.m.tradingDate}</span>
              </div>
            )}
            <div className="mt-1 flex gap-2">
              {row && (
                <button className="btn" onClick={() => openLightbox(row.trade.screens, Math.max(0, screenIdx))}>
                  Screeny
                </button>
              )}
              {row && (
                <button className="btn" onClick={() => navigate({ page: 'trade', id: row.trade.id })}>
                  Transakcja
                </button>
              )}
              <button className="btn btn-accent ml-auto" onClick={next} data-testid="drill-next">
                {session.cards.some((c, i) => i !== index && c.answer == null) ? 'Dalej' : 'Podsumowanie'} <Kbd>Enter</Kbd>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Verdict({ label, ok, na }: { label: string; ok: boolean | null; na: string }) {
  if (ok == null) return na ? <Badge>{`${label}: ${na}`}</Badge> : null
  return <Badge tone={ok ? 'default' : 'accent'}>{`${label} ${ok ? '✓' : '✗'}`}</Badge>
}

function SessionSummary({ session }: { session: DrillSession }) {
  const t = tally(session.cards)
  const rows = useTradeRows()
  const machine = useJournal((s) => s.appInfo?.machineName ?? null)
  const drills = useJournal((s) => s.drills)
  const sessions = useMemo(() => Object.values(drills).map((e) => e.record), [drills])
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="drill-summary">
      <Panel
        title={`Trening ${session.startedAt.slice(0, 16).replace('T', ' ')}`}
        className="border-0"
        actions={
          <>
            <button className="btn h-[22px]" onClick={() => setUi({ summary: null })}>
              Zamknij
            </button>
            <button className="btn btn-accent h-[22px]" onClick={() => startDrill(rows, sessions, machine)}>
              Nowy trening
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[12px]">
          <div className="grid grid-cols-4 border border-line">
            <Cell className="border-r border-line" label="Odpowiedzi" value={`${t.answered} / ${session.cards.length}`} />
            <Cell className="border-r border-line" label="Decyzja" value={pct(t.decisionOk, t.decisionN)} sub={`${t.decisionOk} / ${t.decisionN}`} testId="drill-summary-decision" />
            <Cell className="border-r border-line" label="Kierunek" value={pct(t.directionOk, t.directionN)} sub={`${t.directionOk} / ${t.directionN}`} />
            <Cell className="" label="Błąd SL" value={t.slN ? `${pipsText(t.slErrorSum / t.slN)} p` : '—'} />
          </div>
          <div className="border border-line">
            {session.cards.map((c, i) => {
              const s = scoreCard(c)
              return (
                <div key={i} className="grid grid-cols-[30px_80px_110px_110px_80px_minmax(0,1fr)] items-center gap-2 border-b border-line/60 px-2 py-1 last:border-b-0" data-testid="drill-summary-row">
                  <span className="num text-dim">{i + 1}</span>
                  <span className="num">{c.pair}</span>
                  <span>{c.answer ? ANSWER_LABEL[c.answer] : <span className="text-dim">bez odpowiedzi</span>}</span>
                  <span className="text-muted">{c.truth ? `było: ${c.truth.direction === 'long' ? 'Long' : 'Short'}` : ''}</span>
                  <span className={cx('num', c.truth ? toneClass[tone(c.truth.resultR)] : '')}>{c.truth ? fmtR(c.truth.resultR) : ''}</span>
                  <span className="flex gap-1">{s && <Verdict label="Decyzja" ok={s.decision} na="BE" />}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Panel>
    </div>
  )
}
