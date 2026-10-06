import { useMemo } from 'react'
import { DECISION_LABEL, pairMinutes, pendingReviews, sessionMinutes, setPairField } from '@shared/calc/sessions'
import { formatClock, tradingDateNy } from '@shared/calc/time'
import type { AnalysisSession, PairDecision, SessionPair } from '@shared/schema'
import { activeItems } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { Modal } from '../../components/Modal'
import { Chips, NumberField, Segmented, cx } from '../../components/ui'
import { closeDecisions, fmtDuration, setReviewsOpen, updateSession, useSessionsUi, watchlist } from './actions'

const DECISIONS: Array<{ value: PairDecision; label: string }> = [
  { value: 'trade', label: 'Handluję' },
  { value: 'watch', label: 'Obserwuję' },
  { value: 'reject', label: 'Odrzucam' }
]

/** Decisions of one session: every pair trade / watch / reject (with reasons), time corrections. */
export function DecisionsDialog() {
  const target = useSessionsUi((s) => s.decisions)
  const day = useJournal((s) => (target ? (s.days[target.dayId]?.record ?? null) : null))
  const journal = useJournal((s) => s.journal)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const session = day?.sessions.find((x) => x.id === target?.sessionId) ?? null
  const now = new Date().toISOString()
  const perPair = useMemo(() => (session ? pairMinutes(session, now) : new Map<string, number>()), [session, now])
  if (!target || !day || !session || !journal) return null
  const reasons = activeItems(journal.dictionaries.rejectReasons, session.pairs.flatMap((p) => p.reasonIds))
  const up = (fn: (s: AnalysisSession) => AnalysisSession) => updateSession(day.id, session.id, fn)
  const setPair = <K extends keyof SessionPair>(pair: string, key: K, value: SessionPair[K]) => up((s) => setPairField(s, pair, key, value))
  const missing = watchlist().filter((p) => !session.pairs.some((x) => x.pair === p))
  const undecided = session.pairs.filter((p) => p.decision == null).length
  const start = session.segments[0]?.start
  return (
    <Modal
      title={`Decyzje po analizie – ${session.name || 'Analiza'} (${day.date})`}
      onClose={closeDecisions}
      width={940}
      testId="decisions-dialog"
      footer={
        <>
          <span className="text-[11.5px] text-muted">
            {undecided ? `Bez decyzji: ${undecided}.` : 'Wszystkie pary mają decyzję.'} Zmiany zapisują się od razu; decyzje można poprawić później w planie dnia.
          </span>
          <button
            className="btn btn-accent ml-auto"
            disabled={readOnly}
            onClick={() => {
              up((s) => ({ ...s, decidedAt: s.decidedAt ?? new Date().toISOString() }))
              closeDecisions()
            }}
            data-testid="decisions-done"
          >
            Gotowe
          </button>
        </>
      }
    >
      <fieldset disabled={readOnly} className="flex flex-col gap-2 text-[12px]">
        <div className="flex flex-wrap items-center gap-3">
          <input className="input w-[220px]" value={session.name} onChange={(e) => up((s) => ({ ...s, name: e.currentTarget.value }))} aria-label="Nazwa sesji" />
          <span className="num text-muted">
            {start ? `od ${formatClock(start, 'NY')} NY` : ''} · zmierzone {fmtDuration(sessionMinutes({ ...session, minutesOverride: null }, now), false)}
          </span>
          <label className="flex items-center gap-1.5">
            <span className="text-muted">Czas sesji (min)</span>
            <NumberField
              className="w-[64px]"
              value={session.minutesOverride}
              placeholder={String(Math.round(sessionMinutes({ ...session, minutesOverride: null }, now)))}
              onChange={(v) => up((s) => ({ ...s, minutesOverride: v != null && v >= 0 ? v : null }))}
              aria-label="Czas sesji w minutach"
              data-testid="session-minutes"
            />
          </label>
        </div>
        <div className="border border-line">
          <div className="grid grid-cols-[86px_250px_minmax(0,1fr)_64px_22px] gap-2 border-b border-line bg-raised px-2 py-1 text-[10.5px] tracking-wide text-muted uppercase">
            <span>Para</span>
            <span>Decyzja</span>
            <span>Powód odrzucenia / notatka</span>
            <span className="text-right">min</span>
            <span />
          </div>
          {session.pairs.map((p) => (
            <div key={p.pair} className="grid grid-cols-[86px_250px_minmax(0,1fr)_64px_22px] items-start gap-2 border-b border-line/60 px-2 py-1.5 last:border-b-0" data-testid="decision-row">
              <span className="num pt-0.5 text-fg-strong">{p.pair}</span>
              <Segmented size="sm" value={p.decision} onChange={(v) => setPair(p.pair, 'decision', v)} options={DECISIONS} aria-label={`Decyzja ${p.pair}`} />
              <div className="flex min-w-0 flex-col gap-1">
                {p.decision === 'reject' && (
                  <Chips
                    items={reasons}
                    selected={p.reasonIds}
                    onToggle={(id) => setPair(p.pair, 'reasonIds', p.reasonIds.includes(id) ? p.reasonIds.filter((x) => x !== id) : [...p.reasonIds, id])}
                    empty="Dodaj powody w Ustawienia → Słowniki"
                  />
                )}
                <input className="input h-[22px]" value={p.note} placeholder="notatka (np. czekam na sweep PDH)" onChange={(e) => setPair(p.pair, 'note', e.currentTarget.value)} aria-label={`Notatka ${p.pair}`} />
              </div>
              <NumberField
                className="w-[60px]"
                value={p.minutes}
                placeholder={String(Math.round(perPair.get(p.pair) ?? 0))}
                onChange={(v) => setPair(p.pair, 'minutes', v != null && v >= 0 ? v : null)}
                aria-label={`Minuty ${p.pair}`}
              />
              <button
                className="btn btn-ghost h-[22px] px-1 text-muted hover:text-down"
                title="Usuń parę z tej sesji"
                onClick={() => up((s) => ({ ...s, pairs: s.pairs.filter((x) => x.pair !== p.pair) }))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {missing.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-muted">Dodaj parę:</span>
            {missing.map((pair) => (
              <button
                key={pair}
                className="chip num"
                onClick={() => up((s) => ({ ...s, pairs: [...s.pairs, { pair, decision: null, reasonIds: [], note: '', minutes: null, review: null }] }))}
              >
                + {pair}
              </button>
            ))}
          </div>
        )}
        <p className="text-[11.5px] text-muted">
          Minuty na parę: puste = czas zmierzony dla pary (gdy zaznaczałeś ją w stoperze) plus równa część reszty sesji. Odrzucone pary – po kilku godzinach
          aplikacja zapyta, czy dały jednak dobry setup.
        </p>
      </fieldset>
    </Modal>
  )
}

/** "Did the rejected pair give a good setup?" for every rejection waiting for an answer. */
export function ReviewsDialog() {
  const open = useSessionsUi((s) => s.reviews)
  const days = useJournal((s) => s.days)
  const journal = useJournal((s) => s.journal)
  if (!open || !journal) return null
  const nowIso = new Date().toISOString()
  const items = pendingReviews(Object.values(days).map((e) => e.record), nowIso, tradingDateNy(nowIso))
  const names = new Map(journal.dictionaries.rejectReasons.map((r) => [r.id, r.name]))
  const dayIdOf = (date: string) => Object.values(days).find((e) => e.record.date === date)?.record.id
  return (
    <Modal title={`Odrzucone pary – czy dały dobry setup? (${items.length})`} onClose={() => setReviewsOpen(false)} width={760} testId="reviews-dialog">
      {items.length === 0 ? (
        <div className="py-4 text-center text-muted">Wszystko ocenione.</div>
      ) : (
        <div className="flex flex-col">
          {items.map((r) => (
            <ReviewRow
              key={`${r.sessionId}:${r.pair}`}
              label={`${r.date} · ${r.sessionName || 'Analiza'}`}
              pair={r.pair}
              reasons={r.reasonIds.map((id) => names.get(id) ?? '?').join(', ')}
              onAnswer={(review) => {
                const dayId = dayIdOf(r.date)
                if (dayId) updateSession(dayId, r.sessionId, (s) => setPairField(s, r.pair, 'review', review))
              }}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}

export function ReviewRow({ label, pair, reasons, onAnswer, compact }: { label?: string; pair: string; reasons: string; onAnswer: (r: SessionPair['review']) => void; compact?: boolean }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-2 border-b border-line/60 py-1.5 text-[12px] last:border-b-0', compact && 'py-1')} data-testid="review-row">
      {label && <span className="num text-[11px] text-muted">{label}</span>}
      <span className="num text-fg-strong">{pair}</span>
      {reasons && <span className="text-muted">({reasons})</span>}
      <span className="text-muted">– czy dała jednak dobry setup?</span>
      <span className="ml-auto flex gap-1">
        <button className="btn h-[22px]" onClick={() => onAnswer('setup')} data-testid="review-setup">
          Tak, przegapiłem
        </button>
        <button className="btn h-[22px]" onClick={() => onAnswer('noSetup')} data-testid="review-nosetup">
          Nie – trafne odrzucenie
        </button>
        <button className="btn btn-ghost h-[22px]" onClick={() => onAnswer('unknown')}>
          Nie wiem
        </button>
      </span>
    </div>
  )
}

export { DECISION_LABEL }
