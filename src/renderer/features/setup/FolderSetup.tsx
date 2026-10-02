import { useState } from 'react'
import { api } from '../../lib/api'
import { openResult, useJournal } from '../../store/journal'
import { IconFolder, IconPlus } from '../../components/icons'

/** First run (or missing folder): choose where the journal lives. */
export function FolderSetup() {
  const message = useJournal((s) => s.setupMessage)
  const dir = useJournal((s) => s.setupDir)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => ReturnType<typeof api.pickDataDir>) => {
    setBusy(true)
    try {
      await openResult(await fn())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="w-[560px] animate-pop-in border border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <div className="text-[15px] font-semibold text-fg-strong">
            ICT<span className="text-accent">·</span>JOURNAL
          </div>
          <div className="mt-0.5 text-muted">Wybierz folder, w którym trzymasz dziennik.</div>
        </div>
        <div className="flex flex-col gap-3 p-4 text-[12.5px]">
          <p className="text-fg">
            Dane to zwykłe pliki JSON i WebP w jednym folderze. Może to być folder w OneDrive (synchronizacja między komputerami) albo na
            pendrive. Ten wybór jest zapamiętywany na tym komputerze; na innym komputerze wskażesz ten sam folder.
          </p>
          {message && (
            <div className="border border-accent/40 bg-accent-soft px-3 py-2 text-fg-strong" data-testid="setup-message">
              {message}
              {dir && <div className="num mt-1 truncate text-[11px] text-muted">{dir}</div>}
              {dir && (
                <button className="btn btn-accent mt-2" disabled={busy} onClick={() => run(() => api.openDataDir(dir, true))}>
                  <IconPlus size={13} /> Utwórz dziennik tutaj
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-accent h-[58px] flex-col items-start justify-center gap-0.5 px-3" disabled={busy} onClick={() => run(() => api.pickDataDir('create'))}>
              <span className="flex items-center gap-2 text-[13px]">
                <IconPlus size={14} /> Nowy dziennik
              </span>
              <span className="text-[11px] text-muted">utwórz w pustym folderze</span>
            </button>
            <button className="btn h-[58px] flex-col items-start justify-center gap-0.5 px-3" disabled={busy} onClick={() => run(() => api.pickDataDir('open'))}>
              <span className="flex items-center gap-2 text-[13px]">
                <IconFolder size={14} /> Otwórz istniejący
              </span>
              <span className="text-[11px] text-muted">folder z plikiem journal.json</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
