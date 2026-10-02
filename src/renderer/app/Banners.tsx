import { useState, type ReactNode } from 'react'
import { useJournal } from '../store/journal'
import { navigate } from '../store/ui'
import { dismissUpdateNotice, downloadUpdate, restartToUpdate, useUpdate } from '../store/update'
import { openExternalSafe } from '../features/settings/UpdatesTab'
import { IconCheck, IconSync, IconWarn } from '../components/icons'
import { cx } from '../components/ui'

interface BannerItem {
  key: string
  text: string
  icon?: ReactNode
  actions?: Array<{ label: string; onClick: () => void; accent?: boolean; testId?: string }>
  onClose?: () => void
}

const showUpdates = () => navigate({ page: 'settings', tab: 'updates' })

function useUpdateBanners(): BannerItem[] {
  const s = useUpdate((x) => x.state)
  // Hidden for this session only ("later"); key = phase + version.
  const [hidden, setHidden] = useState<string | null>(null)
  if (!s) return []
  const items: BannerItem[] = []
  if (s.justUpdated)
    items.push({
      key: 'updated',
      icon: <IconCheck size={14} className="shrink-0 text-accent" />,
      text: `Zaktualizowano do wersji ${s.justUpdated.version}.`,
      actions: [{ label: 'Co nowego', onClick: showUpdates }],
      onClose: () => void dismissUpdateNotice()
    })
  const v = s.release?.version ?? ''
  const key = `${s.phase}:${v}`
  if (hidden === key) return items
  const close = () => setHidden(key)
  if (s.phase === 'ready')
    items.push({
      key: 'update-ready',
      icon: <IconSync size={14} className="shrink-0 text-accent" />,
      text: `Wersja ${v} jest pobrana – zainstaluje się po zamknięciu aplikacji.`,
      actions: [
        { label: 'Uruchom ponownie teraz', onClick: () => void restartToUpdate(), accent: true, testId: 'banner-restart-update' },
        { label: 'Szczegóły', onClick: showUpdates }
      ],
      onClose: close
    })
  else if (s.phase === 'available' && (s.mode === 'manual' || !s.prefs.autoDownload))
    items.push({
      key: 'update-available',
      icon: <IconSync size={14} className="shrink-0 text-accent" />,
      text: `Dostępna nowa wersja ${v}.`,
      actions: [
        s.mode === 'manual'
          ? { label: 'Pobierz ze strony', onClick: () => s.release && openExternalSafe(s.release.htmlUrl), accent: true }
          : { label: 'Pobierz', onClick: () => void downloadUpdate(), accent: true, testId: 'banner-download-update' },
        { label: 'Szczegóły', onClick: showUpdates }
      ],
      onClose: close
    })
  else if (s.phase === 'downloading' && !s.prefs.autoDownload) {
    const pct = s.progress?.total ? Math.round((s.progress.received / s.progress.total) * 100) : null
    items.push({
      key: 'update-downloading',
      icon: <IconSync size={14} className="shrink-0 text-accent" />,
      text: `Pobieranie wersji ${v}…${pct != null ? ` ${pct}%` : ''}`
    })
  }
  return items
}

export function Banners() {
  const status = useJournal((s) => s.status)
  const conflicts = useJournal((s) => s.conflicts.length)
  const problems = useJournal((s) => s.problems.filter((p) => p.kind !== 'unknown-file').length)
  const updates = useUpdateBanners()
  const items: BannerItem[] = []
  if (status?.readOnlyReason) items.push({ key: 'ro', text: status.readOnlyReason })
  if (status?.otherMachines.length)
    items.push({
      key: 'other',
      text: `Ten folder jest też otwarty na: ${status.otherMachines.map((m) => m.machine).join(', ')} (aktywność w ostatnich minutach). Zamknij tam aplikację, żeby uniknąć konfliktów.`
    })
  if (status?.migratedFrom != null)
    items.push({ key: 'mig', text: `Dane zaktualizowano z formatu v${status.migratedFrom} do v${status.appSchemaVersion}. Kopia sprzed migracji: ${status.backupPath}` })
  if (conflicts || problems)
    items.push({
      key: 'sync',
      text: `${conflicts ? `Konflikty synchronizacji: ${conflicts}. ` : ''}${problems ? `Pliki z błędami: ${problems}.` : ''}`,
      actions: [{ label: 'Rozstrzygnij', onClick: () => navigate({ page: 'sync' }), accent: true }]
    })
  items.push(...updates)
  if (!items.length) return null
  return (
    <div className="flex flex-col">
      {items.map((b) => (
        <div
          key={b.key}
          className="flex min-h-[28px] items-center gap-2 border-b border-accent/30 bg-accent-soft px-3 text-[12px] text-fg-strong"
          data-testid={`banner-${b.key}`}
        >
          {b.icon ?? <IconWarn size={14} className="shrink-0 text-accent" />}
          <span className="truncate" title={b.text}>
            {b.text}
          </span>
          {(b.actions?.length || b.onClose) && (
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {b.actions?.map((a) => (
                <button key={a.label} className={cx('btn h-[22px]', a.accent && 'btn-accent')} onClick={a.onClick} data-testid={a.testId}>
                  {a.label}
                </button>
              ))}
              {b.onClose && (
                <button className="btn btn-ghost h-[22px] w-[22px] justify-center px-0" title="Ukryj" onClick={b.onClose}>
                  ×
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
