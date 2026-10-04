import type { Forecast } from '@shared/schema'
import { cx } from '../../components/ui'
import { updateScenario } from './actions'
import { Num } from './fields'

const QUICK = [0, 10, 25, 46, 50, 75, 80, 100]

/** "Wypłata z zysku": slider, field and quick choice (chapter 6.1). The bar sticks to the top while scrolling. */
export function PayoutBar({ scenario, readOnly }: { scenario: Forecast; readOnly: boolean }) {
  const set = (v: number) => updateScenario(scenario.id, (f) => ({ ...f, payoutPercent: Math.min(100, Math.max(0, v)) }))
  const p = scenario.payoutPercent
  return (
    <>
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-4 border-b border-line bg-bg px-3 py-2" data-testid="fc-payout-bar">
        <div className="flex w-[260px] shrink-0 flex-col">
          <span className="text-[13px] font-medium text-fg-strong">Wypłata z zysku</span>
          <span className="text-[11px] text-muted">
            {scenario.keep === 'fund' ? 'jaki procent miesięcznego zysku odkładasz do funduszu celowego' : 'jaki procent miesięcznego zysku wypłacasz'}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(p)}
          disabled={readOnly}
          onChange={(e) => set(Number(e.currentTarget.value))}
          className="h-[18px] min-w-[160px] flex-1 accent-[var(--color-accent)]"
          aria-label="Wypłata z zysku (suwak)"
          data-testid="fc-payout-range"
        />
        <div className="flex items-center gap-1.5">
          <Num value={p} onChange={(v) => v != null && set(v)} min={0} max={100} maxDecimals={2} step={1} className="w-[76px]" aria-label="Wypłata z zysku w procentach" data-testid="fc-payout" />
          <span className="text-muted">%</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="text-muted">Szybki wybór:</span>
        {QUICK.map((q) => (
          <button key={q} type="button" className={cx('chip num')} aria-pressed={p === q} disabled={readOnly} onClick={() => set(q)} data-testid={`fc-quick-${q}`}>
            {q}%
          </button>
        ))}
      </div>
    </>
  )
}
