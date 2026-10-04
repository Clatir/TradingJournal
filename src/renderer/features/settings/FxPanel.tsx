import { manualRates, withoutManualRate } from '@shared/fx'
import type { Settings } from '@shared/schema'
import { countLabel } from '../../lib/format'
import { refreshFxRates, useFxFetch } from '../../store/fx'
import { updateJournal, useJournal } from '../../store/journal'
import { IconSync, IconTrash } from '../../components/icons'
import { Panel, Toggle } from '../../components/ui'

const setSettings = (fn: (s: Settings) => Settings) => updateJournal((j) => ({ ...j, settings: fn(j.settings) }))

/** "Kursy walut": automatic NBP table A, manual refresh and the list of hand-entered rates. */
export function FxPanel({ settings }: { settings: Settings }) {
  const busy = useFxFetch((s) => s.busy)
  const readOnly = useJournal((s) => s.status?.readOnly ?? false)
  const nbp = settings.fx.nbp
  const manual = manualRates(settings)
  return (
    <Panel title="Kursy walut">
      <div className="flex flex-col gap-2" data-testid="fx-panel">
        <Toggle
          checked={settings.fx.autoFetch}
          onChange={(v) => setSettings((s) => ({ ...s, fx: { ...s.fx, autoFetch: v } }))}
          label="Pobieraj kursy NBP automatycznie"
          data-testid="fx-auto"
        />
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-muted" data-testid="fx-nbp-info">
            {nbp ? (
              <>
                Tabela A NBP nr <span className="num text-fg-strong">{nbp.no}</span> z dnia <span className="num text-fg-strong">{nbp.effectiveDate}</span>, pobrana{' '}
                <span className="num">{new Date(nbp.fetchedAt).toLocaleString('pl-PL')}</span> ({countLabel(Object.keys(nbp.rates).length, 'waluta', 'waluty', 'walut')}).
              </>
            ) : (
              'Jeszcze nie pobrano.'
            )}
          </span>
          <button className="btn" disabled={busy || readOnly} onClick={() => void refreshFxRates(true)} data-testid="fx-refresh">
            <IconSync size={13} /> {busy ? 'Pobieranie…' : 'Odśwież kursy NBP'}
          </button>
        </div>
        <p className="text-[11.5px] text-muted">
          Kurs średni NBP (tabela A) służy w kalkulatorach i w prognozie, gdy nie wpiszesz własnego. Kurs wpisany ręcznie ma pierwszeństwo. Aplikacja
          łączy się z api.nbp.pl tylko po tabelę kursów i niczego nie wysyła.
        </p>
        <div className="label mt-1">Kursy wpisane ręcznie</div>
        {manual.length === 0 ? (
          <span className="text-[11.5px] text-dim">Brak – wszystkie kursy pochodzą z tabeli NBP.</span>
        ) : (
          <div className="flex flex-col">
            {manual.map((r) => (
              <div key={`${r.from}>${r.to}`} className="flex items-center gap-3 border-b border-line/70 py-1 text-[12px]" data-testid={`fx-manual-${r.from}-${r.to}`}>
                <span className="num w-[220px] text-fg-strong">
                  1 {r.from} = {r.rate} {r.to}
                </span>
                <button
                  className="btn btn-ghost h-[22px] px-1.5"
                  title="Usuń kurs wpisany ręcznie"
                  aria-label={`Usuń kurs ${r.from} → ${r.to}`}
                  onClick={() => setSettings((s) => withoutManualRate(s, r.from, r.to))}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
