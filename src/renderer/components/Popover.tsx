import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './ui'

/** A button with a panel under it; closes on Escape and on a click outside. */
export function Popover({
  label,
  title,
  active,
  align = 'left',
  width = 360,
  disabled,
  testId,
  panelTestId,
  children
}: {
  label: ReactNode
  title?: string
  /** Highlights the button (e.g. filters are set). */
  active?: boolean
  align?: 'left' | 'right'
  width?: number
  disabled?: boolean
  testId?: string
  panelTestId?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className={cx('btn h-[24px]', active && 'border-accent/60 text-accent')}
        title={title}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        {label}
      </button>
      {open && (
        <div
          className={cx('absolute top-[28px] z-40 flex animate-pop-in flex-col gap-2 border border-line-strong bg-panel p-2.5 text-[12px]', align === 'right' ? 'right-0' : 'left-0')}
          style={{ width }}
          data-testid={panelTestId}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
