import { useJournal, flushSaves } from '../store/journal'
import { cx } from '../components/ui'

export function SaveIndicator() {
  const save = useJournal((s) => s.save)
  const status = useJournal((s) => s.status)
  if (status?.readOnly) return <span className="text-[11.5px] text-accent">tylko odczyt</span>
  if (save.error)
    return (
      <button className="btn h-[22px] border-down/60 text-[11.5px] text-down" title={save.error} onClick={() => void flushSaves()} data-testid="save-error">
        błąd zapisu – ponów
      </button>
    )
  const time = save.lastSavedAt ? new Date(save.lastSavedAt).toLocaleTimeString('pl-PL') : null
  return (
    <span className={cx('num text-[11.5px] whitespace-nowrap', save.pending ? 'text-accent' : 'text-muted')} data-testid="save-state">
      {save.pending ? 'zapisywanie…' : time ? `zapisano ${time}` : 'zapis automatyczny'}
    </span>
  )
}
