import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { parseNumberInput } from '../lib/format'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  id
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} className={cx('flex min-w-0 flex-col border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex h-[28px] shrink-0 items-center gap-2 border-b border-line px-2.5">
          <h2 className="label flex-1 truncate font-medium">{title}</h2>
          {actions}
        </header>
      )}
      <div className={cx('min-h-0 flex-1', bodyClassName ?? 'p-2.5')}>{children}</div>
    </section>
  )
}

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5', className)}>
      <span className="truncate text-[11.5px] text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
      {hint && <div className="col-start-2 text-[11px] text-muted">{hint}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

interface NumberFieldProps {
  value: number | null
  onChange: (v: number | null) => void
  decimals?: number
  /** ArrowUp/ArrowDown step (Shift = x10). */
  step?: number
  placeholder?: string
  className?: string
  readOnly?: boolean
  id?: string
  autoFocus?: boolean
  'aria-label'?: string
  'data-testid'?: string
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { value, onChange, decimals, step, placeholder, className, readOnly, id, autoFocus, ...aria },
  ref
) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value == null ? '' : decimals != null ? value.toFixed(decimals) : String(value))
  const invalid = draft != null && parseNumberInput(draft) === undefined
  return (
    <input
      ref={ref}
      id={id}
      autoFocus={autoFocus}
      className={cx('input num text-right', className)}
      inputMode="decimal"
      spellCheck={false}
      value={shown}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-invalid={invalid}
      aria-label={aria['aria-label']}
      data-testid={aria['data-testid']}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const t = e.currentTarget.value
        setDraft(t)
        const parsed = parseNumberInput(t)
        if (parsed !== undefined) onChange(parsed)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (!step || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) {
          if (e.key === 'Enter') setDraft(null)
          return
        }
        e.preventDefault()
        const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
        const next = (value ?? 0) + delta
        onChange(decimals != null ? Number(next.toFixed(decimals)) : next)
        setDraft(null)
      }}
    />
  )
})

export function TextField({
  value,
  onChange,
  placeholder,
  className,
  mono,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  mono?: boolean
  'aria-label'?: string
  'data-testid'?: string
}) {
  return (
    <input
      className={cx('input', mono && 'num', className)}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.currentTarget.value)}
      {...rest}
    />
  )
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Grow with content up to a limit; manual resize still possible.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(260, Math.max(el.scrollHeight + 2, rows * 18 + 12))}px`
  }, [value, rows])
  return (
    <textarea
      ref={ref}
      className={cx('input', className)}
      value={value}
      rows={rows}
      placeholder={placeholder}
      spellCheck
      lang="pl"
      onChange={(e) => onChange(e.currentTarget.value)}
      {...rest}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
  ...rest
}: {
  value: T | null
  options: Array<{ value: T; label: ReactNode; title?: string; className?: string }>
  onChange: (v: T) => void
  className?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
}) {
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className={cx('inline-flex border border-line-strong', className)}>
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'px-2.5 transition-colors duration-100',
              size === 'sm' ? 'h-[22px] text-[11.5px]' : 'h-[24px]',
              i > 0 && 'border-l border-line-strong',
              active ? (o.className ?? 'bg-accent-soft text-accent') : 'text-muted hover:bg-hover hover:text-fg-strong'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Chips({
  items,
  selected,
  onToggle,
  empty
}: {
  items: Array<{ id: string; name: string }>
  selected: string[]
  onToggle: (id: string) => void
  empty?: ReactNode
}) {
  if (items.length === 0) return <span className="text-[11.5px] text-dim">{empty ?? 'Brak pozycji w słowniku'}</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => (
        <button key={it.id} type="button" className="chip" aria-pressed={selected.includes(it.id)} onClick={() => onToggle(it.id)}>
          {it.name}
        </button>
      ))}
    </div>
  )
}

export function Badge({ children, tone = 'default', title }: { children: ReactNode; tone?: 'default' | 'accent' | 'up' | 'down' | 'warn'; title?: string }) {
  const tones = {
    default: 'border-line-strong text-muted',
    accent: 'border-accent/50 text-accent',
    up: 'border-up/40 text-up',
    down: 'border-down/40 text-down',
    warn: 'border-accent/50 text-accent'
  }
  return (
    <span title={title} className={cx('inline-flex h-[18px] items-center border px-1.5 text-[10.5px] uppercase tracking-wide', tones[tone])}>
      {children}
    </span>
  )
}

export function Stat({ label, value, className, valueClassName }: { label: ReactNode; value: ReactNode; className?: string; valueClassName?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="label truncate">{label}</span>
      <span className={cx('num text-[14px] text-fg-strong', valueClassName)}>{value}</span>
    </div>
  )
}

export function Toggle({ checked, onChange, label, ...rest }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; 'data-testid'?: string }) {
  return (
    <label className="inline-flex cursor-default items-center gap-2" data-testid={rest['data-testid']}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-[16px] w-[28px] border transition-colors duration-150',
          checked ? 'border-accent bg-accent-soft' : 'border-line-strong bg-bg'
        )}
      >
        <span
          className={cx(
            'absolute top-[2px] h-[10px] w-[10px] transition-all duration-150',
            checked ? 'left-[14px] bg-accent' : 'left-[2px] bg-muted'
          )}
        />
      </button>
      <span>{label}</span>
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-muted">{children}</div>
}
