import { useEffect, useMemo, useRef, useState } from 'react'
import { activeSession, isRunning, pauseSession, pendingReviews, resumeSession, sessionMinutes, stopSession, switchPair } from '@shared/calc/sessions'
import { tradingDateNy } from '@shared/calc/time'
import { useJournal } from '../../store/journal'
import { IconTimer } from '../../components/icons'
import { cx } from '../../components/ui'
import { fmtDuration, openDecisions, setReviewsOpen, startAnalysis, updateSession } from './actions'

const PRESETS = ['Przed Londynem', 'Przed NY', 'HTF (tydzień)', 'Po sesji']

function useTick(active: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => clearInterval(t)
  }, [active])
  return active ? now : new Date().toISOString()
}

/** Stopwatch of the portfolio analysis in the top bar (Ctrl+Shift+A starts / stops it). */
export function AnalysisTimer() {
  const days = useJournal((s) => s.days)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const pairsAll = useJournal((s) => s.journal?.settings.pairs)
  const machine = useJournal((s) => s.appInfo?.machineName ?? null)
  const active = useMemo(() => activeSession(Object.values(days).map((e) => e.record)), [days])
  const running = active ? isRunning(active.session) : false
  const now = useTick(!!active)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(PRESETS[0]!)
  const [pairs, setPairs] = useState<string[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    const onToggle = () => {
      const a = activeSession(Object.values(useJournal.getState().days).map((e) => e.record))
      if (a) {
        const t = new Date().toISOString()
        updateSession(a.day.id, a.session.id, (s) => stopSession(s, t))
        openDecisions(a.day.id, a.session.id)
      } else setOpen(true)
    }
    window.addEventListener('ictj:analysis-toggle', onToggle)
    return () => window.removeEventListener('ictj:analysis-toggle', onToggle)
  }, [])

  // Recomputed on every render (the top bar ticks every second): a rejection becomes a question 3 h after the session.
  const nowIso = new Date().toISOString()
  const reviews = pendingReviews(Object.values(days).map((e) => e.record), nowIso, tradingDateNy(nowIso)).length
  const watch = pairsAll?.filter((p) => !p.archived).map((p) => p.symbol) ?? []
  const chosen = pairs ?? watch
  const elapsed = active ? sessionMinutes(active.session, now) : 0
  const currentPair = active && running ? active.session.segments.at(-1)?.pair : null
  const t = () => new Date().toISOString()

  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      {reviews > 0 && (
        <button className="btn h-[22px] text-[11.5px] text-muted" onClick={() => setReviewsOpen(true)} title="Odrzucone pary: czy dały dobry setup?" data-testid="reviews-chip">
          Pytania: {reviews}
        </button>
      )}
      <button
        className={cx(
          'num flex h-[22px] items-center gap-1.5 border px-2 text-[11.5px]',
          running ? 'border-accent/60 bg-accent-soft text-accent' : active ? 'border-line-strong text-fg' : 'border-transparent text-muted hover:text-fg-strong'
        )}
        onClick={() => setOpen((o) => !o)}
        title="Sesja analizy portfolio (Ctrl+Shift+A)"
        data-testid="timer-button"
      >
        <IconTimer size={13} />
        {active ? (
          <>
            <span data-testid="timer-elapsed">{fmtDuration(elapsed)}</span>
            {!running && <span className="text-muted">pauza</span>}
            {currentPair && <span className="text-fg">· {currentPair}</span>}
          </>
        ) : (
          <span>Analiza</span>
        )}
      </button>
      {open && (
        <div className="absolute top-[26px] right-0 z-40 flex w-[360px] animate-pop-in flex-col gap-2 border border-line-strong bg-panel p-2.5 text-[12px]" data-testid="timer-panel">
          {!active ? (
            <>
              <span className="label">Nowa sesja analizy</span>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button key={p} className="chip" aria-pressed={name === p} onClick={() => setName(p)}>
                    {p}
                  </button>
                ))}
              </div>
              <input className="input" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Nazwa sesji" data-testid="timer-name" />
              <span className="label">Pary do przeglądu</span>
              <div className="flex flex-wrap gap-1">
                {watch.map((p) => (
                  <button
                    key={p}
                    className="chip num"
                    aria-pressed={chosen.includes(p)}
                    onClick={() => setPairs(chosen.includes(p) ? chosen.filter((x) => x !== p) : [...chosen, p])}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-accent self-end"
                disabled={readOnly || chosen.length === 0}
                onClick={() => {
                  startAnalysis(name, watch.filter((p) => chosen.includes(p)))
                  setOpen(false)
                }}
                data-testid="timer-start"
              >
                Start
              </button>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-fg-strong">{active.session.name || 'Analiza'}</span>
                <span className="num text-muted">{fmtDuration(elapsed)}</span>
                {active.session.machine && active.session.machine !== machine && <span className="text-[11px] text-accent">na {active.session.machine}</span>}
              </div>
              <span className="label">Teraz analizuję</span>
              <div className="flex flex-wrap gap-1">
                {[null, ...active.session.pairs.map((p) => p.pair)].map((p) => (
                  <button
                    key={p ?? '-'}
                    className="chip num"
                    aria-pressed={running && currentPair === p}
                    onClick={() => updateSession(active.day.id, active.session.id, (s) => switchPair(s, p, t()))}
                    data-testid={`timer-pair-${p ?? 'all'}`}
                  >
                    {p ?? 'całość'}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-muted">Czas zaznaczonej pary liczy się osobno; reszta dzieli się równo między pary sesji.</div>
              <div className="flex gap-2">
                {running ? (
                  <button className="btn" onClick={() => updateSession(active.day.id, active.session.id, (s) => pauseSession(s, t()))} data-testid="timer-pause">
                    Pauza
                  </button>
                ) : (
                  <button className="btn" onClick={() => updateSession(active.day.id, active.session.id, (s) => resumeSession(s, t()))} data-testid="timer-resume">
                    Wznów
                  </button>
                )}
                <button
                  className="btn btn-accent ml-auto"
                  onClick={() => {
                    updateSession(active.day.id, active.session.id, (s) => stopSession(s, t()))
                    openDecisions(active.day.id, active.session.id)
                    setOpen(false)
                  }}
                  data-testid="timer-stop"
                >
                  Zakończ i zdecyduj
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

