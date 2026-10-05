import { useState } from 'react'
import type { ConflictEntry } from '@shared/api'
import { api, errorMessage } from '../../lib/api'
import { flushSaves, useJournal } from '../../store/journal'
import { toast } from '../../store/ui'
import { IconFolder, IconSync, IconTrash } from '../../components/icons'
import { Badge, Panel, cx } from '../../components/ui'

const KIND_LABEL: Record<string, string> = { trades: 'Transakcja', days: 'Plan dnia', weeks: 'Przegląd tygodnia', library: 'Biblioteka', forecasts: 'Scenariusz prognozy', journal: 'Ustawienia (journal.json)' }
const PROBLEM_LABEL: Record<string, string> = {
  corrupt: 'uszkodzony',
  invalid: 'zła struktura',
  'too-new': 'nowszy format',
  'unknown-file': 'nieznany plik'
}

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === 'object')) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  } else {
    out[prefix] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return out
}

function ConflictCard({ c }: { c: ConflictEntry }) {
  const [busy, setBusy] = useState(false)
  const a = flatten(c.canonical.record ?? {})
  const b = flatten(c.copy.record ?? {})
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k] && k !== 'updatedAt')
  const resolve = async (keep: 'canonical' | 'copy') => {
    setBusy(true)
    try {
      await flushSaves()
      await api.resolveConflict(c.id, keep)
      toast('Konflikt rozstrzygnięty – odrzucona wersja jest w Koszu.', 'success')
    } catch (e) {
      toast(errorMessage(e), 'error', 6000)
    } finally {
      setBusy(false)
    }
  }
  const side = (label: string, s: ConflictEntry['canonical'], keep: 'canonical' | 'copy') => (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="label">{label}</span>
        <span className="num truncate text-[11px] text-muted" title={s.relPath}>
          {s.relPath.split('/').pop()}
        </span>
      </div>
      <div className="num text-[11px] text-dim">
        zmieniony: {s.updatedAt ? new Date(s.updatedAt).toLocaleString('pl-PL') : '—'}
        {s.mtimeMs ? ` · plik: ${new Date(s.mtimeMs).toLocaleString('pl-PL')}` : ''}
      </div>
      {s.error && <div className="text-[11.5px] text-down">{s.error}</div>}
      <button className="btn self-start" disabled={busy || (!s.record && keep === 'copy')} onClick={() => resolve(keep)} data-testid={`keep-${keep}`}>
        Zachowaj tę wersję
      </button>
    </div>
  )
  return (
    <Panel
      title={
        <span className="flex items-center gap-2 normal-case">
          <span>{KIND_LABEL[c.kind] ?? c.kind}</span>
          <Badge>{c.type === 'copy' ? c.source : 'duplikat identyfikatora'}</Badge>
        </span>
      }
      actions={
        <button className="btn btn-ghost h-[22px] px-1.5" title="Pokaż w folderze" onClick={() => api.showInFolder(c.copy.relPath)}>
          <IconFolder size={13} />
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        {side('Oryginał', c.canonical, 'canonical')}
        {side('Kopia', c.copy, 'copy')}
      </div>
      {keys.length > 0 && c.canonical.record != null && c.copy.record != null && (
        <div className="mt-2 border border-line">
          <div className="grid grid-cols-[180px_1fr_1fr] border-b border-line bg-raised px-2 py-1 text-[10.5px] tracking-wide text-muted uppercase">
            <span>Pole</span>
            <span>Oryginał</span>
            <span>Kopia</span>
          </div>
          {keys.slice(0, 40).map((k) => (
            <div key={k} className="grid grid-cols-[180px_1fr_1fr] gap-2 border-b border-line/60 px-2 py-0.5 text-[11.5px] last:border-b-0">
              <span className="num truncate text-muted" title={k}>
                {k}
              </span>
              <span className="truncate" title={a[k]}>
                {a[k] ?? <span className="text-dim">—</span>}
              </span>
              <span className="truncate text-fg-strong" title={b[k]}>
                {b[k] ?? <span className="text-dim">—</span>}
              </span>
            </div>
          ))}
          {keys.length > 40 && <div className="px-2 py-1 text-[11px] text-muted">… i {keys.length - 40} innych różnic</div>}
        </div>
      )}
      {keys.length === 0 && c.canonical.record != null && c.copy.record != null && (
        <div className="mt-2 text-[11.5px] text-muted">Treść identyczna (różni się tylko czas zapisu) – można bezpiecznie zachować oryginał.</div>
      )}
    </Panel>
  )
}

export function SyncPage() {
  const conflicts = useJournal((s) => s.conflicts)
  const problems = useJournal((s) => s.problems)
  const status = useJournal((s) => s.status)
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-[14px] font-medium text-fg-strong">Synchronizacja i problemy</h1>
          <button className="btn ml-auto" onClick={() => api.rescan().then(() => toast('Przeskanowano folder.', 'success'))}>
            <IconSync size={13} /> Przeskanuj teraz
          </button>
        </div>
        <p className="text-[11.5px] text-muted">
          Gdy ten sam plik zmieni się na dwóch komputerach, usługa synchronizacji (OneDrive, Dropbox, Google Drive) tworzy jego kopię zamiast
          nadpisywać. Aplikacja pokazuje takie kopie tutaj – wybierz, którą wersję zachować; druga trafia do Kosza.
        </p>
        {status && status.otherMachines.length > 0 && (
          <Panel title="Inne komputery">
            {status.otherMachines.map((m) => (
              <div key={m.machine} className="num text-[12px]">
                {m.machine} – ostatnia aktywność {new Date(m.lastSeen).toLocaleTimeString('pl-PL')}
              </div>
            ))}
          </Panel>
        )}
        <h2 className="label mt-1">Konflikty ({conflicts.length})</h2>
        {conflicts.length === 0 && <div className="border border-line bg-panel p-3 text-muted">Brak konfliktów.</div>}
        {conflicts.map((c) => (
          <ConflictCard key={c.id} c={c} />
        ))}
        <h2 className="label mt-1">Pliki z problemami ({problems.length})</h2>
        {problems.length === 0 && <div className="border border-line bg-panel p-3 text-muted">Wszystkie pliki wczytane poprawnie.</div>}
        {problems.length > 0 && (
          <div className="border border-line bg-panel">
            {problems.map((p) => (
              <div key={p.relPath} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line/70 px-2.5 py-1.5 last:border-b-0" data-testid="problem-row">
                <Badge tone={p.kind === 'unknown-file' ? 'default' : 'down'}>{PROBLEM_LABEL[p.kind]}</Badge>
                <div className="min-w-0">
                  <div className="num truncate text-[12px] text-fg-strong">{p.relPath}</div>
                  <div className={cx('truncate text-[11.5px]', p.kind === 'unknown-file' ? 'text-muted' : 'text-down')} title={p.message}>
                    {p.message}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="btn h-[22px]" onClick={() => api.showInFolder(p.relPath)}>
                    <IconFolder size={12} /> Pokaż
                  </button>
                  <button
                    className="btn h-[22px] hover:text-down"
                    onClick={() => api.trashProblemFile(p.relPath).then(() => toast('Plik przeniesiony do Kosza.', 'success'), (e) => toast(errorMessage(e), 'error'))}
                  >
                    <IconTrash size={12} /> Do Kosza
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11.5px] text-muted">
          Uszkodzone pliki są pomijane i nigdy nie są nadpisywane – możesz je naprawić w edytorze tekstu (to zwykły JSON) albo przywrócić z kopii w
          folderze backups/.
        </p>
      </div>
    </div>
  )
}
