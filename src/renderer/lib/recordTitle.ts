import type { HistoryKind } from '@shared/api'
import { tradingDateNy } from '@shared/calc/time'

const s = (v: unknown) => (typeof v === 'string' ? v : '')

/** Short human name of a record for lists and dialogs ("Transakcja 2026-10-01 EURUSD long", "Plan dnia 2026-10-01"…). */
export function recordTitle(kind: HistoryKind, record: unknown): string {
  const r = (record ?? {}) as Record<string, unknown>
  switch (kind) {
    case 'trades': {
      const date = s(r.entryTime) ? tradingDateNy(s(r.entryTime)) : '?'
      return `Transakcja ${date} ${s(r.pair)} ${s(r.direction)}${r.status === 'missed' ? ' (missed)' : ''}`.trim()
    }
    case 'days':
      return `Plan dnia ${s(r.date)}`
    case 'weeks':
      return `Przegląd tygodnia ${s(r.week)}`
    case 'library':
      return `Biblioteka: ${s(r.title) || 'bez tytułu'}`
    case 'forecasts':
      return `Scenariusz prognozy: ${s(r.name) || 'bez nazwy'}`
    case 'journal':
      return 'Ustawienia i słowniki'
    default:
      return String(kind)
  }
}
