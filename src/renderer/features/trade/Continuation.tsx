import { useMemo } from 'react'
import { continuationCandidate, continuationsOf, closeTime, type ContinuationCheck } from '@shared/calc/continuation'
import { formatClock } from '@shared/calc/time'
import type { Settings, Trade } from '@shared/schema'
import { fmtR } from '../../lib/format'
import { metricsFor } from '../../store/derived'
import { updateRecord, useJournal } from '../../store/journal'
import { navigate } from '../../store/ui'
import { cx } from '../../components/ui'

const when = (iso: string) => `${formatClock(iso, 'NY')} NY / ${formatClock(iso, 'WAW')} WAW`

/**
 * A re-opened position: which closed trade this one continues (killzone from its first entry), a suggestion when one
 * fits (the same pair and direction closed earlier the same NY trading day), and the re-entries of this trade.
 */
export function ContinuationBox({ trade, check, settings, readOnly }: { trade: Trade; check: ContinuationCheck | null; settings: Settings; readOnly: boolean }) {
  const trades = useJournal((s) => s.trades)
  const all = useMemo(() => Object.values(trades).map((e) => e.record), [trades])
  const candidate = useMemo(() => continuationCandidate(trade, all), [trade, all])
  const children = useMemo(() => continuationsOf(trade.id, all), [trade.id, all])
  const set = (id: string | null) => updateRecord('trades', trade.id, (t) => ({ ...t, continuationOf: id }))

  if (!check && !candidate && !children.length) return null
  return (
    <div className="mt-1.5 flex flex-col gap-1 text-[11.5px]">
      {check && (
        <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1 border px-2 py-1', check.ok ? 'border-line' : 'border-accent/50 bg-accent-soft')} data-testid="continuation-info">
          <span className={check.ok ? 'text-fg-strong' : 'text-accent'} data-testid="continuation-status">
            {check.ok
              ? `↻ Kontynuacja transakcji z ${when(check.parent.entryTime)}${check.originKillzones.length ? ` – killzone z pierwszego wejścia: ${check.originKillzones.join(' + ')}` : ' – pierwsze wejście też poza killzone'}`
              : `Nie liczy się jako kontynuacja: ${check.reason}. Zasada killzone jak dla nowego wejścia.`}
          </span>
          {check.parent && (
            <button type="button" className="text-accent hover:underline" onClick={() => navigate({ page: 'trade', id: check.parent!.id })} data-testid="continuation-open">
              otwórz pierwotną
            </button>
          )}
          {!readOnly && (
            <button type="button" className="text-muted hover:text-fg-strong hover:underline" onClick={() => set(null)} data-testid="continuation-clear">
              to nie kontynuacja
            </button>
          )}
        </div>
      )}
      {!check && candidate && !readOnly && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-dashed border-line-strong px-2 py-1 text-muted" data-testid="continuation-suggest">
          <span>
            {candidate.pair} {candidate.direction === 'long' ? 'long' : 'short'} zamknięta dziś o {when(closeTime(candidate) as string)} – to jej ponowne otwarcie?
          </span>
          <button type="button" className="text-accent hover:underline" onClick={() => set(candidate.id)} data-testid="continuation-accept">
            Tak, kontynuacja
          </button>
        </div>
      )}
      {children.map((c) => {
        const r = metricsFor(c, settings).resultR
        return (
          <div key={c.id} className="flex items-center gap-2 text-muted" data-testid="continuation-child">
            <span>↻ Otwarta ponownie {when(c.entryTime)}</span>
            {r != null && <span className="num">{fmtR(r)}</span>}
            <button type="button" className="text-accent hover:underline" onClick={() => navigate({ page: 'trade', id: c.id })}>
              otwórz
            </button>
          </div>
        )
      })}
    </div>
  )
}
