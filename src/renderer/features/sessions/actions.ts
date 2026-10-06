import { create } from 'zustand'
import { newDayPlan } from '@shared/dayTemplates'
import { startSession } from '@shared/calc/sessions'
import { tradingDateNy } from '@shared/calc/time'
import type { AnalysisSession, DayPlan } from '@shared/schema'
import { addRecord, updateRecord, useJournal } from '../../store/journal'
import { toast } from '../../store/ui'

/** Dialogs of the analysis sessions (decisions of one session; questions about rejected pairs). */
export const useSessionsUi = create<{ decisions: { dayId: string; sessionId: string } | null; reviews: boolean }>(() => ({ decisions: null, reviews: false }))

export function openDecisions(dayId: string, sessionId: string): void {
  useSessionsUi.setState({ decisions: { dayId, sessionId } })
}

export function closeDecisions(): void {
  useSessionsUi.setState({ decisions: null })
}

export function setReviewsOpen(reviews: boolean): void {
  useSessionsUi.setState({ reviews })
}

/** Pairs of the watchlist (Ustawienia → Pary, not archived). */
export function watchlist(): string[] {
  return useJournal.getState().journal?.settings.pairs.filter((p) => !p.archived).map((p) => p.symbol) ?? []
}

/** Id of the day plan of `date`, created (and saved) when there is none. */
export function ensureDayPlan(date: string): string | null {
  const { days, journal, status } = useJournal.getState()
  if (!journal || status?.readOnly) return null
  const existing = Object.values(days).find((e) => e.record.date === date)
  if (existing) return existing.record.id
  const plan = newDayPlan(date, journal.settings, watchlist())
  addRecord('days', plan)
  return plan.id
}

export function updateSession(dayId: string, sessionId: string, fn: (s: AnalysisSession) => AnalysisSession): void {
  updateRecord('days', dayId, (d: DayPlan) => ({ ...d, sessions: d.sessions.map((s) => (s.id === sessionId ? fn(s) : s)) }))
}

export function removeSession(dayId: string, sessionId: string): void {
  updateRecord('days', dayId, (d: DayPlan) => ({ ...d, sessions: d.sessions.filter((s) => s.id !== sessionId) }))
}

/** Start the stopwatch for a new session in today's plan (New York date). */
export function startAnalysis(name: string, pairs: string[]): void {
  const now = new Date().toISOString()
  const dayId = ensureDayPlan(tradingDateNy(now))
  if (!dayId) {
    toast('Folder tylko do odczytu – nie można zapisać sesji.', 'error')
    return
  }
  const machine = useJournal.getState().appInfo?.machineName ?? null
  const session = startSession(name.trim() || 'Analiza', pairs, now, machine)
  updateRecord('days', dayId, (d: DayPlan) => ({ ...d, sessions: [...d.sessions, session] }))
}

/** A session entered after the fact (forgotten stopwatch): ended now, `minutes` long; decisions open right away. */
export function addManualSession(date: string, minutes: number): void {
  const dayId = ensureDayPlan(date)
  if (!dayId) return
  const now = new Date().toISOString()
  const start = new Date(Date.parse(now) - minutes * 60_000).toISOString()
  const machine = useJournal.getState().appInfo?.machineName ?? null
  const base = startSession('Analiza (wpisana ręcznie)', watchlist(), start, machine)
  const session: AnalysisSession = { ...base, segments: [{ start, end: now, pair: null }], endedAt: now, minutesOverride: minutes }
  updateRecord('days', dayId, (d: DayPlan) => ({ ...d, sessions: [...d.sessions, session] }))
  openDecisions(dayId, session.id)
}

/** "1:05:12" / "12:04" for a duration in minutes. */
export function fmtDuration(minutes: number, seconds = true): string {
  const total = Math.max(0, Math.round(minutes * 60))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (!seconds) return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
