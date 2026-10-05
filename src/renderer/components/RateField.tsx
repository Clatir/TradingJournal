import type { ReactNode } from 'react'
import { shownDecimals } from '@shared/calc/position'
import { nbpRate, rateFor, withManualRate, withoutManualRate } from '@shared/fx'
import type { Settings } from '@shared/schema'
import { updateJournal } from '../store/journal'
import { Field, NumberField } from './ui'

const setSettings = (fn: (s: Settings) => Settings) => updateJournal((j) => ({ ...j, settings: fn(j.settings) }))

/** Where the rate comes from, for the hint under a rate field (chapter 14.3). */
export function rateHint(from: string, to: string, settings: Settings, noneHint: ReactNode, testId?: string): ReactNode {
  const r = rateFor(from, to, settings)
  if (r?.source === 'nbp') return `kurs NBP z dnia ${settings.fx.nbp?.effectiveDate ?? '—'} — możesz wpisać własny`
  if (r?.source === 'manual')
    return (
      <span>
        kurs wpisany ręcznie
        {nbpRate(from, to, settings) != null && (
          <>
            {' · '}
            <button
              className="text-accent hover:underline"
              onClick={() => setSettings((s) => withoutManualRate(s, from, to))}
              data-testid={testId ? `${testId}-nbp` : undefined}
            >
              przywróć kurs NBP
            </button>
          </>
        )}
      </span>
    )
  return noneHint
}

/**
 * "1 FROM = [rate] TO": shows the rate from `rateFor` (hand-entered, else NBP); typing stores a hand-entered
 * rate (risk.conversionRates for the account currency, otherwise fx.manual).
 */
export function RateField({
  from,
  to,
  settings,
  noneHint,
  label = 'Kurs',
  labelWidth,
  testId
}: {
  from: string
  to: string
  settings: Settings
  noneHint: ReactNode
  label?: ReactNode
  /** Width of the label column, to line up with the other fields of the panel. */
  labelWidth?: number
  testId?: string
}) {
  const rate = rateFor(from, to, settings)?.rate ?? null
  return (
    <Field label={label} labelWidth={labelWidth} hint={rateHint(from, to, settings, noneHint, testId)}>
      <div className="flex items-center gap-2">
        <span className="num w-[54px] shrink-0 text-muted">1 {from} =</span>
        <NumberField
          value={rate}
          onChange={(v) => v != null && v > 0 && setSettings((s) => withManualRate(s, from, to, v))}
          decimals={shownDecimals(rate, 4)}
          step={0.0001}
          data-testid={testId}
        />
        <span className="num text-muted">{to}</span>
      </div>
    </Field>
  )
}
