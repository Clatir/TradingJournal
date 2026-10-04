import { forwardRef } from 'react'
import { shownDecimals } from '@shared/calc/position'
import { NumberField, cx } from '../../components/ui'

export const MONTH_NAMES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Number field of the forecast: a value outside the range is clipped (not refused), at most `maxDecimals`
 * places are kept; an emptied field keeps the last value unless `nullable` (appendix B).
 */
export const Num = forwardRef<
  HTMLInputElement,
  {
    value: number | null
    onChange: (v: number | null) => void
    min?: number
    max?: number
    /** 'upTo': as many places as the value has (≤ maxDecimals); 'money': 0 or 2; 'int': whole numbers. */
    format?: 'upTo' | 'money' | 'int'
    maxDecimals?: number
    step?: number
    nullable?: boolean
    isValid?: (v: number | null) => boolean
    placeholder?: string
    className?: string
    'aria-label'?: string
    'data-testid'?: string
  }
>(function Num({ value, onChange, min = -Infinity, max = Infinity, format = 'upTo', maxDecimals = 2, step = 1, nullable, isValid, placeholder, className, ...rest }, ref) {
  const places = format === 'int' ? 0 : format === 'money' ? 2 : maxDecimals
  const decimals = value == null ? undefined : format === 'int' ? 0 : format === 'money' ? (Number.isInteger(value) ? 0 : 2) : Math.min(maxDecimals, shownDecimals(value, 0))
  return (
    <NumberField
      ref={ref}
      value={value}
      decimals={decimals}
      step={step}
      placeholder={placeholder}
      className={cx('w-[110px]', className)}
      isValid={isValid}
      aria-label={rest['aria-label']}
      data-testid={rest['data-testid']}
      onChange={(v) => {
        if (v == null) {
          if (nullable) onChange(null)
          return
        }
        const clipped = clamp(v, min, max)
        onChange(format === 'int' ? Math.round(clipped) : Number(clipped.toFixed(places)))
      }}
    />
  )
})
