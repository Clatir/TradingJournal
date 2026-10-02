import { useUi } from '../store/ui'
import { cx } from './ui'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-3 bottom-8 z-[60] flex flex-col items-end gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'pointer-events-auto max-w-[460px] animate-slide-up border bg-raised px-3 py-1.5 text-[12px]',
            t.kind === 'error' ? 'border-down/60 text-fg-strong' : t.kind === 'success' ? 'border-accent/50 text-fg-strong' : 'border-line-strong text-fg'
          )}
        >
          {t.kind === 'error' && <span className="mr-2 text-down">Błąd</span>}
          {t.text}
        </div>
      ))}
    </div>
  )
}
