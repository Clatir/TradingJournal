import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, ImportPolicy, ImportReport } from '@shared/api'
import { api, errorMessage } from '../../lib/api'
import { fmtBytes } from '../../lib/format'
import { flushSaves, openResult } from '../../store/journal'
import { toast } from '../../store/ui'
import { IconFolder } from '../../components/icons'
import { Badge, Panel, Segmented, cx } from '../../components/ui'
import { exportCsv } from '../export/markdownActions'

const KIND = { daily: 'dzienna (JSON)', weekly: 'tygodniowa (pełna)', manual: 'ręczna (pełna)', 'pre-migration': 'przed migracją' } as const

export function TransferTab() {
  const [report, setReport] = useState<ImportReport | null>(null)
  const [policy, setPolicy] = useState<ImportPolicy>('newer')
  const [busy, setBusy] = useState(false)
  const [backups, setBackups] = useState<{ dir: string; files: BackupInfo[] } | null>(null)

  const loadBackups = useCallback(async () => {
    try {
      setBackups(await api.listBackups())
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }, [])
  useEffect(() => {
    void loadBackups()
  }, [loadBackups])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e), 'error', 7000)
    } finally {
      setBusy(false)
    }
  }

  const inspect = (kind: 'zip' | 'folder') =>
    run(async () => {
      await flushSaves()
      const r = await api.inspectImport(kind)
      if (r) setReport(r)
    })

  const total = report ? Object.values(report.valid).reduce((a, b) => a + b, 0) : 0
  const newerIncoming = report?.collisions.filter((c) => c.newer === 'incoming').length ?? 0

  return (
    <>
      <Panel title="Eksport">
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy} onClick={() => void exportCsv()} data-testid="export-csv">
            CSV wszystkich transakcji (Excel)
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await flushSaves()
                const path = await api.exportZip()
                if (path) toast(`Zapisano ZIP: ${path}`, 'success', 6000)
              })
            }
            data-testid="export-zip"
          >
            ZIP całego folderu danych
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          CSV: separator średnik, UTF-8 z BOM, przecinek dziesiętny – otwiera się bezpośrednio w polskim Excelu. Markdown pojedynczego wpisu: przycisk
          „MD” w transakcji i planie dnia albo Ctrl+Shift+M.
        </p>
      </Panel>

      <Panel title="Import (folder lub ZIP)">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button className="btn" disabled={busy} onClick={() => inspect('folder')} data-testid="import-folder">
              Wybierz folder…
            </button>
            <button className="btn" disabled={busy} onClick={() => inspect('zip')} data-testid="import-zip">
              Wybierz plik ZIP…
            </button>
          </div>
          <p className="text-[11.5px] text-muted">Najpierw każdy plik jest sprawdzany – nic nie jest zmieniane, dopóki nie wybierzesz, co zrobić.</p>
          {report && (
            <div className="flex flex-col gap-2 border border-line p-2.5" data-testid="import-report">
              <div className="num truncate text-[12px] text-fg-strong" title={report.source}>
                {report.source}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                <span>transakcje <b className="num text-fg-strong">{report.valid.trades}</b></span>
                <span>plany dni <b className="num text-fg-strong">{report.valid.days}</b></span>
                <span>tygodnie <b className="num text-fg-strong">{report.valid.weeks}</b></span>
                <span>biblioteka <b className="num text-fg-strong">{report.valid.library}</b></span>
                <span>scenariusze prognozy <b className="num text-fg-strong">{report.valid.forecasts}</b></span>
                <span>screeny <b className="num text-fg-strong">{report.screens}</b></span>
                {!report.hasJournal && <Badge tone="warn">brak journal.json</Badge>}
                {report.tooNew && <Badge tone="warn">część plików w nowszym formacie</Badge>}
              </div>
              {report.invalid.length > 0 && (
                <div className="max-h-[120px] overflow-y-auto border border-down/40 p-1.5 text-[11.5px]">
                  <div className="mb-1 text-down">Pliki z błędami ({report.invalid.length}) – zostaną pominięte:</div>
                  {report.invalid.map((x) => (
                    <div key={x.relPath} className="truncate" title={x.error}>
                      <span className="num">{x.relPath}</span> <span className="text-muted">– {x.error}</span>
                    </div>
                  ))}
                </div>
              )}
              {report.collisions.length > 0 && (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  <span>
                    Te same wpisy są już w dzienniku: <b className="num">{report.collisions.length}</b> (w imporcie nowszych: <b className="num">{newerIncoming}</b>)
                  </span>
                  <Segmented
                    size="sm"
                    value={policy}
                    onChange={setPolicy}
                    options={[
                      { value: 'newer', label: 'Nowsza wersja wygrywa' },
                      { value: 'skip', label: 'Pomiń istniejące' },
                      { value: 'overwrite', label: 'Nadpisz importem' }
                    ]}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  className="btn btn-accent"
                  disabled={busy || total === 0}
                  onClick={() =>
                    run(async () => {
                      const res = await api.applyImport(report.token, policy)
                      toast(`Zaimportowano ${res.imported} wpisów (pominięto ${res.skipped}), skopiowano ${res.screensCopied} plików screenów.`, 'success', 6000)
                      setReport(null)
                    })
                  }
                  data-testid="import-merge"
                >
                  Scal z bieżącym dziennikiem
                </button>
                {report.hasJournal && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (!(await flushSaves())) throw new Error('Nie udało się zapisać bieżących zmian – spróbuj ponownie za chwilę.')
                        const res = await api.openImportAsNew(report.token)
                        if (await openResult(res)) {
                          toast('Otwarto zaimportowany dziennik jako folder danych.', 'success')
                          setReport(null)
                        } else if (!res.ok && res.reason !== 'cancelled') toast(res.message, 'error', 7000)
                      })
                    }
                  >
                    Otwórz jako osobny dziennik
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => setReport(null)}>
                  Anuluj
                </button>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Kopie zapasowe"
        actions={
          <div className="flex gap-1">
            <button
              className="btn h-[22px]"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const path = await api.backupNow()
                  toast(`Utworzono kopię: ${path}`, 'success', 6000)
                  await loadBackups()
                })
              }
              data-testid="backup-now"
            >
              Pełna kopia teraz
            </button>
            {backups && (
              <button className="btn h-[22px]" onClick={() => api.showPath(backups.dir)}>
                <IconFolder size={12} />
              </button>
            )}
          </div>
        }
      >
        <p className="mb-2 text-[11.5px] text-muted">
          Przy każdym starcie: raz dziennie ZIP z samymi plikami JSON (zostaje 14), raz w tygodniu pełny ZIP ze screenami (zostają 4). Folder:{' '}
          <span className="num">{backups?.dir}</span>
        </p>
        {backups && backups.files.length === 0 && <span className="text-[11.5px] text-dim">Brak kopii.</span>}
        {backups?.files.map((b) => (
          <div key={b.path} className={cx('grid grid-cols-[150px_minmax(0,1fr)_90px_150px] items-center gap-2 border-b border-line/60 py-[3px] text-[12px] last:border-b-0')} data-testid="backup-row">
            <span className="text-muted">{KIND[b.kind]}</span>
            <button className="num truncate text-left hover:text-fg-strong" onClick={() => api.showPath(b.path)} title={b.path}>
              {b.name}
            </button>
            <span className="num text-right text-muted">{fmtBytes(b.bytes)}</span>
            <span className="num text-right text-dim">{new Date(b.mtimeMs).toLocaleString('pl-PL')}</span>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2">
          <button
            className="btn h-[22px]"
            onClick={() =>
              run(async () => {
                await api.setBackupDir('pick')
                await loadBackups()
              })
            }
          >
            Zmień folder kopii…
          </button>
          <button
            className="btn h-[22px]"
            onClick={() =>
              run(async () => {
                await api.setBackupDir('default')
                await loadBackups()
              })
            }
          >
            Domyślny (backups/ w folderze danych)
          </button>
          <span className="text-[11px] text-dim">ustawienie tego komputera – np. dysk lokalny zamiast OneDrive</span>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">Przywracanie: rozpakuj wybrany ZIP do pustego folderu i wskaż go w zakładce „Folder danych” albo zaimportuj go powyżej.</p>
      </Panel>
    </>
  )
}
