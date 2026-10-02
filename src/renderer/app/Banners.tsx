import { useJournal } from '../store/journal'
import { navigate } from '../store/ui'
import { IconWarn } from '../components/icons'

export function Banners() {
  const status = useJournal((s) => s.status)
  const conflicts = useJournal((s) => s.conflicts.length)
  const problems = useJournal((s) => s.problems.filter((p) => p.kind !== 'unknown-file').length)
  if (!status) return null
  const items: Array<{ key: string; text: string; action?: () => void; actionLabel?: string; strong?: boolean }> = []
  if (status.readOnlyReason) items.push({ key: 'ro', text: status.readOnlyReason, strong: true })
  if (status.otherMachines.length)
    items.push({
      key: 'other',
      text: `Ten folder jest też otwarty na: ${status.otherMachines.map((m) => m.machine).join(', ')} (aktywność w ostatnich minutach). Zamknij tam aplikację, żeby uniknąć konfliktów.`
    })
  if (status.migratedFrom != null)
    items.push({ key: 'mig', text: `Dane zaktualizowano z formatu v${status.migratedFrom} do v${status.appSchemaVersion}. Kopia sprzed migracji: ${status.backupPath}` })
  if (conflicts || problems)
    items.push({
      key: 'sync',
      text: `${conflicts ? `Konflikty synchronizacji: ${conflicts}. ` : ''}${problems ? `Pliki z błędami: ${problems}.` : ''}`,
      action: () => navigate({ page: 'sync' }),
      actionLabel: 'Rozstrzygnij'
    })
  if (!items.length) return null
  return (
    <div className="flex flex-col">
      {items.map((b) => (
        <div
          key={b.key}
          className="flex min-h-[28px] items-center gap-2 border-b border-accent/30 bg-accent-soft px-3 text-[12px] text-fg-strong"
          data-testid={`banner-${b.key}`}
        >
          <IconWarn size={14} className="shrink-0 text-accent" />
          <span className="truncate" title={b.text}>
            {b.text}
          </span>
          {b.action && (
            <button className="btn btn-accent ml-auto h-[22px]" onClick={b.action}>
              {b.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
