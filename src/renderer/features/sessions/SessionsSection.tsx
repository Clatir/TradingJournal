import { useState } from 'react'
import { DECISION_LABEL, isRunning, pendingReviews, sessionMinutes, setPairField } from '@shared/calc/sessions'
import { formatClock } from '@shared/calc/time'
import type { DayPlan } from '@shared/schema'
import { useJournal } from '../../store/journal'
import { Badge, Panel, cx } from '../../components/ui'
import { addManualSession, fmtDuration, openDecisions, removeSession, updateSession } from './actions'
import { ReviewRow } from './SessionDialogs'

/** Analysis sessions of a day plan: time, decisions, questions about rejected pairs. */
export function SessionsSection({ day, readOnly, today }: { day: DayPlan; readOnly: boolean; today: string }) {
  const reasons = useJournal((s) => s.journal?.dictionaries.rejectReasons)
  const [confirm, setConfirm] = useState<string | null>(null)
  const now = new Date().toISOString()
  const names = new Map((reasons ?? []).map((r) => [r.id, r.name]))
  const questions = pendingReviews([day], now, today)
  const total = day.sessions.reduce((a, s) => a + sessionMinutes(s, now), 0)
  return (
    <Panel
      title={`Sesje analizy (${day.sessions.length})${day.sessions.length ? ` · ${fmtDuration(total, false)}` : ''}`}
      className="border-0 border-b"
      actions={
        !readOnly && (
          <button className="btn h-[22px]" onClick={() => addManualSession(day.date, 30)} title="Sesja bez stopera: wpisz czas i decyzje" data-testid="session-manual">
            + wpisz ręcznie
          </button>
        )
      }
    >
      {day.sessions.length === 0 ? (
        <div className="text-[11.5px] text-muted">Brak sesji. Stoper „Analiza” w pasku u góry (Ctrl+Shift+A) mierzy czas przeglądu wszystkich par.</div>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid="sessions-list">
          {day.sessions.map((s) => {
            const counts = { trade: 0, watch: 0, reject: 0 }
            for (const p of s.pairs) if (p.decision) counts[p.decision]++
            const start = s.segments[0]?.start
            const end = s.endedAt ?? s.segments.at(-1)?.end
            return (
              <div key={s.id} className="flex flex-col gap-1 border border-line px-2 py-1.5 text-[12px]" data-testid="session-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-fg-strong">{s.name || 'Analiza'}</span>
                  <span className="num text-muted">
                    {start ? formatClock(start, 'NY') : ''}
                    {end ? `–${formatClock(end, 'NY')}` : ''} NY · {fmtDuration(sessionMinutes(s, now), false)}
                  </span>
                  {isRunning(s) && <Badge tone="accent">trwa</Badge>}
                  {s.machine && <span className="text-[11px] text-dim">{s.machine}</span>}
                  <span className="ml-auto flex gap-1">
                    {!readOnly && (
                      <button className="btn h-[22px]" onClick={() => openDecisions(day.id, s.id)} data-testid="session-decisions">
                        Decyzje
                      </button>
                    )}
                    {!readOnly &&
                      (confirm === s.id ? (
                        <button className="btn h-[22px] border-down/60 text-down" onClick={() => removeSession(day.id, s.id)}>
                          Usuń na pewno
                        </button>
                      ) : (
                        <button className="btn btn-ghost h-[22px] px-1 hover:text-down" onClick={() => setConfirm(s.id)} title="Usuń sesję">
                          ×
                        </button>
                      ))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.pairs.map((p) => (
                    <span
                      key={p.pair}
                      className={cx('num border px-1.5 text-[11px]', p.decision === 'trade' ? 'border-accent/60 text-accent' : p.decision === 'reject' ? 'border-line text-dim line-through' : 'border-line text-muted')}
                      title={p.decision ? `${DECISION_LABEL[p.decision]}${p.reasonIds.length ? ` – ${p.reasonIds.map((id) => names.get(id) ?? '?').join(', ')}` : ''}${p.note ? ` – ${p.note}` : ''}` : 'bez decyzji'}
                    >
                      {p.pair}
                    </span>
                  ))}
                  <span className="num text-[11px] text-muted">
                    · handluję {counts.trade} · obserwuję {counts.watch} · odrzucam {counts.reject}
                  </span>
                </div>
                {!readOnly &&
                  questions
                    .filter((q) => q.sessionId === s.id)
                    .map((q) => (
                      <ReviewRow
                        key={q.pair}
                        pair={q.pair}
                        compact
                        reasons={q.reasonIds.map((id) => names.get(id) ?? '?').join(', ')}
                        onAnswer={(review) => updateSession(day.id, s.id, (x) => setPairField(x, q.pair, 'review', review))}
                      />
                    ))}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
