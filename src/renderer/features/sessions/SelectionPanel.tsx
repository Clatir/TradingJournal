import { useMemo } from 'react'
import { selectionStats } from '@shared/calc/sessions'
import type { TradeMetrics } from '@shared/calc/trade'
import type { Trade } from '@shared/schema'
import { fmtMoneyGrouped, fmtPercent, fmtR } from '../../lib/format'
import { useJournal } from '../../store/journal'
import { Panel, cx } from '../../components/ui'
import { fmtDuration } from './actions'

const perUnit = (minutes: number | null) => (minutes == null ? '—' : fmtDuration(minutes, false))

/** Analytics: time of the portfolio analysis and the quality of the selection (date range of the page's filter). */
export function SelectionPanel({ rows, from, to }: { rows: ReadonlyArray<{ trade: Trade; m: TradeMetrics }>; from: string | null; to: string | null }) {
  const days = useJournal((s) => s.days)
  const journal = useJournal((s) => s.journal)
  const st = useMemo(() => selectionStats(Object.values(days).map((e) => e.record), rows, { from, to, now: new Date().toISOString() }), [days, rows, from, to])
  if (!journal) return null
  const names = new Map(journal.dictionaries.rejectReasons.map((r) => [r.id, r.name]))
  const showMoney = journal.settings.display.showMoney
  const cur = journal.settings.risk.accountCurrency
  return (
    <Panel title="Czas analizy i selekcja par" className="border-0 border-t border-line">
      {st.sessions === 0 ? (
        <div className="py-4 text-center text-[12px] text-dim">Brak sesji analizy w zakresie. Stoper „Analiza” w pasku u góry (Ctrl+Shift+A).</div>
      ) : (
        <div className="flex flex-col gap-3 text-[12px]" data-testid="selection-panel">
          <div className="grid grid-cols-6 border border-line" data-testid="selection-kpis">
            <Cell label="Sesje · czas" value={`${st.sessions} · ${fmtDuration(st.minutes, false)}`} />
            <Cell label="Lejek" value={`${st.analysed} → ${st.decisions.trade + st.decisions.watch} → ${st.trades} → ${st.wins}`} sub="pary → wybrane → wejścia → wygrane" />
            <Cell label="Wejścia z selekcji" value={st.trades ? `${st.fromSelection} / ${st.trades}` : '—'} sub="para oznaczona handluję / obserwuję" />
            <Cell label="Czas na wejście" value={perUnit(st.minutesPerTrade)} />
            <Cell label="Czas na 1R" value={perUnit(st.minutesPerR)} sub={`Σ ${fmtR(st.totalR, 1)}`} />
            <Cell
              label={showMoney ? 'Zarobek na godzinę' : 'Trafność odrzuceń'}
              value={showMoney ? (st.moneyPerHour != null ? fmtMoneyGrouped(st.moneyPerHour, cur) : '—') : fmtPercent(st.rejectAccuracy, 0)}
              sub={showMoney ? `trafność odrzuceń ${fmtPercent(st.rejectAccuracy, 0)}` : 'odrzucone bez dobrego setupu'}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Table
              title="Powody odrzucenia"
              head={['Powód', 'n', 'ocen.', 'trafne']}
              rows={st.reasons.map((r) => [names.get(r.reasonId) ?? (r.reasonId === '-' ? 'bez powodu' : '?'), String(r.rejected), String(r.reviewed), r.reviewed ? fmtPercent(r.noSetup / r.reviewed, 0) : '—'])}
              testId="selection-reasons"
            />
            <Table
              title="Pary: czas a wynik"
              head={['Para', 'czas', 'wybr.', 'wej.', 'Σ R', 'czas/1R']}
              rows={st.pairs.map((p) => [p.pair, fmtDuration(p.minutes, false), `${p.selected}/${p.analysed}`, String(p.trades), fmtR(p.totalR, 1), perUnit(p.minutesPerR)])}
              testId="selection-pairs"
            />
            <Table
              title="Czas analizy dnia a wynik dnia"
              head={['Czas', 'dni', 'śr. R dnia']}
              rows={st.buckets.map((b) => [b.label, String(b.days), b.avgR == null ? '—' : fmtR(b.avgR)])}
              testId="selection-buckets"
            />
          </div>
        </div>
      )}
    </Panel>
  )
}

function Cell({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-r border-line px-2.5 py-1.5 last:border-r-0">
      <span className="label truncate">{label}</span>
      <span className={cx('num truncate text-[14px] text-fg-strong', cls)}>{value}</span>
      {sub && <span className="truncate text-[10.5px] text-dim">{sub}</span>}
    </div>
  )
}

function Table({ title, head, rows, testId }: { title: string; head: string[]; rows: string[][]; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid={testId}>
      <span className="label mb-1">{title}</span>
      <div className="border border-line">
        <div className="grid border-b border-line bg-raised px-2 py-0.5 text-[10.5px] tracking-wide text-muted uppercase" style={{ gridTemplateColumns: `minmax(0,1.6fr) repeat(${head.length - 1}, minmax(0,1fr))` }}>
          {head.map((h, i) => (
            <span key={h} className={i ? 'text-right' : ''}>
              {h}
            </span>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="px-2 py-1 text-dim">—</div>
        ) : (
          rows.map((r, ri) => (
            <div key={ri} className="grid border-b border-line/50 px-2 py-0.5 last:border-b-0" style={{ gridTemplateColumns: `minmax(0,1.6fr) repeat(${head.length - 1}, minmax(0,1fr))` }}>
              {r.map((c, i) => (
                <span key={i} className={cx('truncate', i ? 'num text-right' : '')}>
                  {c}
                </span>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
