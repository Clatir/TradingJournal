import type { RuleStatus, ValidationResult } from '@shared/calc/validator'
import { navigate } from '../../store/ui'
import { IconCheck, IconClose, IconWarn } from '../../components/icons'
import { cx } from '../../components/ui'

const STATUS_ICON: Record<RuleStatus, React.ReactNode> = {
  pass: <IconCheck size={13} />,
  fail: <IconClose size={13} />,
  info: <IconWarn size={13} />,
  na: <span className="text-[11px]">–</span>
}

const STATUS_CLASS: Record<RuleStatus, string> = {
  pass: 'text-fg-strong',
  fail: 'text-accent',
  info: 'text-accent',
  na: 'text-dim'
}

/** Rule compliance of a trade. Flags only – saving is never blocked. */
export function ValidatorPanel({ v, date, hasPlan }: { v: ValidationResult; date: string; hasPlan: boolean }) {
  const pct = v.score == null ? null : Math.round(v.score * 100)
  return (
    <div className="flex flex-col gap-1.5" data-testid="validator">
      <div className="flex items-baseline gap-3">
        <span className={cx('num text-[20px] font-medium', v.compliant === false ? 'text-accent' : 'text-fg-strong')} data-testid="compliance-score">
          {pct == null ? '—' : `${pct}%`}
        </span>
        <span className="text-[12px] text-muted">
          {v.compliant == null ? 'brak danych do oceny' : v.compliant ? 'zgodna z zasadami' : `złamane zasady: ${v.broken.length}`}
          {v.applicable > 0 && <span className="num ml-2 text-dim">({v.passed}/{v.applicable})</span>}
        </span>
        {!hasPlan && (
          <button className="btn ml-auto h-[22px] text-[11.5px]" onClick={() => navigate({ page: 'day', date })}>
            Plan dnia {date}
          </button>
        )}
      </div>
      <div className="flex flex-col">
        {v.rules.map((r) => (
          <div key={r.id} className="grid grid-cols-[18px_minmax(0,190px)_minmax(0,1fr)] items-center gap-1.5 border-b border-line/60 py-[3px] text-[12px] last:border-b-0" data-testid={`rule-${r.id}`} data-status={r.status}>
            <span className={cx('flex justify-center', STATUS_CLASS[r.status])}>{STATUS_ICON[r.status]}</span>
            <span className={cx('truncate', r.status === 'fail' ? 'text-fg-strong' : 'text-fg')}>{r.label}</span>
            <span className={cx('num truncate text-[11.5px]', r.status === 'fail' ? 'text-accent' : 'text-muted')} title={r.detail}>
              {r.detail}
              {!r.affectsScore && <span className="ml-1 text-dim">(informacyjnie)</span>}
            </span>
          </div>
        ))}
        {v.rules.length === 0 && <span className="text-[11.5px] text-dim">Wszystkie zasady wyłączone w ustawieniach.</span>}
      </div>
    </div>
  )
}
