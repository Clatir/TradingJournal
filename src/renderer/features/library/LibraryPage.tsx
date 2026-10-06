import { useEffect, useMemo, useState } from 'react'
import { fileUrl } from '@shared/api'
import { newId } from '@shared/ids'
import { SCHEMA_VERSION, libraryItemSchema, type LibraryItem, type ScreenRef, type Trade } from '@shared/schema'
import { metricsFor } from '../../store/derived'
import { addRecord, deleteRecord, discardDraft, updateRecord, useJournal } from '../../store/journal'
import { navigate, openLightbox, toast } from '../../store/ui'
import { AnnotationLayer } from '../../components/annotations'
import { IconClose, IconCopy, IconPlus, IconTrash } from '../../components/icons'
import { Badge, Chips, Field, Panel, Segmented, TextArea, TextField, cx } from '../../components/ui'
import { HistoryButton } from '../history/HistoryDialog'
import { errorMessage } from '../../lib/api'
import { parseDateInput } from '../../lib/format'
import { ScreensPanel } from '../screens/ScreensPanel'
import { duplicateLibraryEntry } from '../duplicate'

type TypeFilter = 'all' | 'live' | 'backtest'

/** Create a library example from a trade (shares the screenshot files, no copies). */
export function addTradeToLibrary(t: Trade): string | null {
  const { journal, status } = useJournal.getState()
  if (!journal) return null
  if (status?.readOnly) {
    toast(status.readOnlyReason ?? 'Folder danych jest tylko do odczytu.', 'error')
    return null
  }
  const m = metricsFor(t, journal.settings)
  const now = new Date().toISOString()
  const item = libraryItemSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: `${t.pair} ${t.direction === 'long' ? 'long' : 'short'} – ${journal.dictionaries.entryModels.find((d) => d.id === t.entryModelId)?.name ?? 'setup'}`,
    type: 'live',
    pair: t.pair,
    direction: t.direction,
    date: m.tradingDate,
    entryModelId: t.entryModelId,
    killzoneId: m.killzoneIds[0] ?? null,
    pdArrayIds: [t.entryPdArrayId, t.htfPdArrayId].filter((x): x is string => !!x),
    notes: t.notes,
    linkedTradeId: t.id,
    screens: t.screens
  })
  addRecord('library', item)
  navigate({ page: 'library', id: item.id })
  toast('Dodano do biblioteki – screeny są współdzielone z transakcją.', 'success')
  return item.id
}

export function LibraryPage({ id }: { id?: string }) {
  const library = useJournal((s) => s.library)
  const journal = useJournal((s) => s.journal)
  const readOnly = useJournal((s) => s.status?.readOnly ?? false)
  const [type, setType] = useState<TypeFilter>('all')
  const [pair, setPair] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(null)

  const items = useMemo(
    () =>
      Object.values(library)
        .map((e) => e.record)
        .filter((i) => (type === 'all' || i.type === type) && (!pair || i.pair === pair) && (!model || i.entryModelId === model) && (!session || i.killzoneId === session))
        .sort((a, b) => ((b.date ?? b.createdAt) < (a.date ?? a.createdAt) ? -1 : 1)),
    [library, type, pair, model, session]
  )

  if (!journal) return null
  const selected = id ? library[id] : null
  const usedPairs = [...new Set(Object.values(library).map((e) => e.record.pair).filter((x): x is string => !!x))]

  const create = () => {
    const now = new Date().toISOString()
    const item = libraryItemSchema.parse({ schemaVersion: SCHEMA_VERSION, id: newId(), createdAt: now, updatedAt: now, title: '', type: 'backtest', pair: 'EURUSD', date: now.slice(0, 10) })
    addRecord('library', item, { draft: true })
    navigate({ page: 'library', id: item.id })
  }

  return (
    <div className="flex h-full min-h-0" data-testid="library">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[36px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
          <Segmented
            size="sm"
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: 'Wszystkie' },
              { value: 'live', label: 'Live' },
              { value: 'backtest', label: 'Backtest' }
            ]}
          />
          <select className="input h-[24px] w-[170px]" value={model ?? ''} onChange={(e) => setModel(e.currentTarget.value || null)} aria-label="Model">
            <option value="">wszystkie modele</option>
            {journal.dictionaries.entryModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select className="input h-[24px] w-[140px]" value={session ?? ''} onChange={(e) => setSession(e.currentTarget.value || null)} aria-label="Sesja">
            <option value="">wszystkie sesje</option>
            {journal.settings.killzones.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {usedPairs.map((p) => (
              <button key={p} className="chip num" aria-pressed={pair === p} onClick={() => setPair(pair === p ? null : p)}>
                {p}
              </button>
            ))}
          </div>
          <button className="btn btn-accent ml-auto" onClick={create} disabled={readOnly} data-testid="new-library">
            <IconPlus size={13} /> Nowy przykład
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
              <span>Biblioteka jest pusta{type !== 'all' || pair || model || session ? ' dla wybranych filtrów' : ''}.</span>
              <span className="text-[12px] text-dim">Dodaj przykład ręcznie albo przyciskiem „Do biblioteki” w transakcji.</span>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
              {items.map((it) => (
                <LibraryCard key={it.id} item={it} active={it.id === id} />
              ))}
            </div>
          )}
        </div>
      </div>
      {selected && <LibraryDetail key={selected.record.id} item={selected.record} readOnly={readOnly || selected.readOnly} />}
    </div>
  )
}

function LibraryCard({ item, active }: { item: LibraryItem; active: boolean }) {
  const journal = useJournal((s) => s.journal)
  const shot = item.screens[0]
  const model = journal?.dictionaries.entryModels.find((m) => m.id === item.entryModelId)?.name
  const kz = journal?.settings.killzones.find((k) => k.id === item.killzoneId)?.name
  return (
    <button
      className={cx('flex flex-col border bg-panel text-left transition-colors duration-150', active ? 'border-accent/70' : 'border-line hover:border-line-strong')}
      onClick={() => navigate({ page: 'library', id: item.id })}
      data-testid="library-card"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {shot ? (
          <>
            <img src={fileUrl(shot.thumbPath)} alt="" loading="lazy" className="h-full w-full object-fill" />
            <AnnotationLayer annotations={shot.annotations} width={shot.width} height={shot.height} />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[11.5px] text-dim">bez screena</div>
        )}
        <span className={cx('absolute top-1 left-1 px-1 text-[10px] tracking-wide uppercase', item.type === 'live' ? 'bg-accent text-bg' : 'bg-black/75 text-fg')}>{item.type}</span>
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        <span className="truncate text-[12.5px] text-fg-strong">{item.title || 'bez tytułu'}</span>
        <span className="truncate text-[11px] text-muted">
          <span className="num">{item.pair}</span>
          {item.direction ? ` · ${item.direction}` : ''}
          {model ? ` · ${model}` : ''}
          {kz ? ` · ${kz}` : ''}
          {item.date ? ` · ${item.date}` : ''}
        </span>
      </div>
    </button>
  )
}

function LibraryDetail({ item, readOnly }: { item: LibraryItem; readOnly: boolean }) {
  const journal = useJournal((s) => s.journal)!
  const linked = useJournal((s) => (item.linkedTradeId ? s.trades[item.linkedTradeId]?.record : undefined))
  const [confirm, setConfirm] = useState(false)
  const [dateDraft, setDateDraft] = useState<string | null>(null)
  useEffect(() => () => discardDraft('library', item.id), [item.id])
  const up = (fn: (i: LibraryItem) => LibraryItem) => updateRecord('library', item.id, fn)
  const set = <K extends keyof LibraryItem>(k: K, v: LibraryItem[K]) => up((i) => ({ ...i, [k]: v }))

  return (
    <aside className="flex w-[480px] shrink-0 flex-col border-l border-line bg-panel" data-testid="library-detail">
      <div className="flex h-[36px] shrink-0 items-center gap-2 border-b border-line px-2">
        <span className="label flex-1">Przykład setupu</span>
        <HistoryButton kind="library" id={item.id} current={item} small />
        {!readOnly && (
          <button className="btn h-[22px]" onClick={() => duplicateLibraryEntry(item.id)} title="Utwórz kopię przykładu (Ctrl+Shift+D)" data-testid="duplicate-library">
            <IconCopy size={12} /> Duplikuj
          </button>
        )}
        {!readOnly &&
          (confirm ? (
            <button
              className="btn h-[22px] border-down/60 text-down"
              onClick={async () => {
                try {
                  await deleteRecord('library', item.id)
                  navigate({ page: 'library' })
                } catch (e) {
                  toast(errorMessage(e), 'error')
                }
              }}
            >
              Usuń na pewno
            </button>
          ) : (
            <button className="btn btn-ghost h-[22px] px-1.5 hover:text-down" onClick={() => setConfirm(true)} title="Usuń przykład">
              <IconTrash size={13} />
            </button>
          ))}
        <button className="btn btn-ghost h-[22px] px-1.5" onClick={() => navigate({ page: 'library' })} aria-label="Zamknij">
          <IconClose />
        </button>
      </div>
      <fieldset disabled={readOnly} className="min-h-0 flex-1 overflow-y-auto">
        <Panel className="border-0 border-b">
          <div className="flex flex-col gap-1.5">
            <TextField value={item.title} onChange={(v) => set('title', v)} placeholder="Tytuł, np. London sweep → MSS → FVG" data-testid="library-title" />
            <Field label="Rodzaj">
              <Segmented
                size="sm"
                value={item.type}
                onChange={(v) => set('type', v)}
                options={[
                  { value: 'live', label: 'Live' },
                  { value: 'backtest', label: 'Backtest' }
                ]}
              />
            </Field>
            <Field label="Para / kierunek">
              <div className="flex gap-2">
                <select className="input w-[110px]" value={item.pair ?? ''} onChange={(e) => set('pair', e.currentTarget.value || null)}>
                  <option value="">—</option>
                  {journal.settings.pairs.map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.symbol}
                    </option>
                  ))}
                </select>
                <Segmented
                  size="sm"
                  value={item.direction}
                  onChange={(v) => set('direction', item.direction === v ? null : v)}
                  options={[
                    { value: 'long', label: 'Long' },
                    { value: 'short', label: 'Short' }
                  ]}
                />
              </div>
            </Field>
            <Field label="Data / sesja">
              <div className="flex gap-2">
                <input
                  className="input num w-[110px]"
                  value={dateDraft ?? item.date ?? ''}
                  placeholder="RRRR-MM-DD"
                  onChange={(e) => setDateDraft(e.currentTarget.value)}
                  onBlur={() => {
                    if (dateDraft != null) {
                      const text = dateDraft.trim()
                      const date = text ? parseDateInput(text) : null
                      // A typo must not erase the stored date: invalid input just reverts.
                      if (text && !date) toast('Nieprawidłowa data – zostawiono poprzednią.', 'error')
                      else if (date !== item.date) set('date', date)
                    }
                    setDateDraft(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <select className="input" value={item.killzoneId ?? ''} onChange={(e) => set('killzoneId', e.currentTarget.value || null)} aria-label="Sesja">
                  <option value="">—</option>
                  {journal.settings.killzones.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Model">
              <Chips
                items={journal.dictionaries.entryModels.filter((d) => !d.archived || d.id === item.entryModelId)}
                selected={item.entryModelId ? [item.entryModelId] : []}
                onToggle={(v) => set('entryModelId', item.entryModelId === v ? null : v)}
              />
            </Field>
            <Field label="PD arrays">
              <Chips
                items={journal.dictionaries.pdArrays.filter((d) => !d.archived || item.pdArrayIds.includes(d.id))}
                selected={item.pdArrayIds}
                onToggle={(v) => set('pdArrayIds', item.pdArrayIds.includes(v) ? item.pdArrayIds.filter((x) => x !== v) : [...item.pdArrayIds, v])}
              />
            </Field>
            <TextArea value={item.notes} onChange={(v) => set('notes', v)} rows={3} placeholder="Co jest kluczowe w tym przykładzie" />
            {linked && (
              <div className="flex items-center gap-2 text-[12px]">
                <Badge tone="accent">powiązana transakcja</Badge>
                <button className="btn h-[22px]" onClick={() => navigate({ page: 'trade', id: linked.id })}>
                  {linked.pair} {linked.direction} {linked.entryTime.slice(0, 10)}
                </button>
              </div>
            )}
          </div>
        </Panel>
        <Panel title={`Screeny (${item.screens.length}) – ✎ adnotacje`} className="border-0 border-b">
          <ScreensPanel
            screens={item.screens}
            onChange={(fn: (s: ScreenRef[]) => ScreenRef[]) => up((i) => ({ ...i, screens: fn(i.screens) }))}
            date={item.date ?? item.createdAt.slice(0, 10)}
            withPhases={false}
            capturePaste={!readOnly}
            readOnly={readOnly}
            labelPrefix="setup"
          />
          {item.screens.length > 0 && (
            <button className="btn mt-2 h-[22px]" onClick={() => openLightbox(item.screens, 0)}>
              Podgląd pełny
            </button>
          )}
        </Panel>
      </fieldset>
    </aside>
  )
}
