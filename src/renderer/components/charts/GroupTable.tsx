import type { Group } from '@shared/calc/analytics'
import { fmtMoneyGrouped, fmtPercent, fmtR, tone, toneClass } from '../../lib/format'
import { cx } from '../ui'

/**
 * Breakdown table with an inline diverging bar of total R (green/red only for results); with `money` also the Σ in PLN
 * (only trades with a known PLN result, the count shown when not all have one).
 */
export function GroupTable({ groups, be, labelHeader, money }: { groups: Group[]; be: number; labelHeader: string; money?: boolean }) {
  const max = Math.max(0.0001, ...groups.map((g) => Math.abs(g.totalR)))
  if (groups.length === 0) return <div className="py-2 text-[11.5px] text-dim">Brak zamkniętych transakcji.</div>
  const cols = money ? 'grid-cols-[minmax(0,1.3fr)_30px_42px_54px_56px_minmax(78px,auto)_minmax(40px,1fr)]' : 'grid-cols-[minmax(0,1.3fr)_34px_46px_58px_62px_minmax(80px,1fr)]'
  return (
    <div className="text-[12px]">
      <div className={cx('grid gap-x-2 border-b border-line pb-1 text-[10.5px] tracking-wide text-muted uppercase', cols)}>
        <span>{labelHeader}</span>
        <span className="text-right">n</span>
        <span className="text-right">WR</span>
        <span className="text-right">E(R)</span>
        <span className="text-right">Σ R</span>
        {money && <span className="text-right">PLN</span>}
        <span />
      </div>
      {groups.map((g) => {
        const w = (Math.abs(g.totalR) / max) * 50
        return (
          <div key={g.key} className={cx('grid items-center gap-x-2 border-b border-line/50 py-[3px] last:border-b-0', cols)} data-testid="group-row">
            <span className="truncate" title={g.label}>
              {g.label}
            </span>
            <span className="num text-right text-muted">{g.count}</span>
            <span className="num text-right">{fmtPercent(g.winRate)}</span>
            <span className={cx('num text-right', toneClass[tone(g.expectancy, 0)])}>{fmtR(g.expectancy)}</span>
            <span className={cx('num text-right font-medium', toneClass[tone(g.totalR, be)])}>{fmtR(g.totalR, 1)}</span>
            {money && (
              <span
                className={cx('num truncate text-right', g.pln == null ? 'text-dim' : toneClass[tone(g.pln)])}
                title={g.plnCount < g.count ? `PLN z ${g.plnCount} z ${g.count} transakcji (reszta bez kwoty albo kursu)` : undefined}
                data-testid="group-pln"
              >
                {g.pln == null ? '—' : fmtMoneyGrouped(g.pln, '').trim()}
                {g.pln != null && g.plnCount < g.count ? '*' : ''}
              </span>
            )}
            <svg className="h-[10px] w-full" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
              <line x1="50" y1="0" x2="50" y2="10" stroke="#2b323b" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
              <rect x={g.totalR >= 0 ? 50 : 50 - w} y="2" width={Math.max(w, 0.5)} height="6" fill={g.totalR >= 0 ? '#2ebd85' : '#f6465d'} opacity="0.85" />
            </svg>
          </div>
        )
      })}
    </div>
  )
}
