import { useMemo, useState } from 'react'
import type { RecordEntry } from '@shared/api'
import { diffRecords, fieldLabel, merge3, pathKey, type Side } from '@shared/merge'
import type { Collection } from '@shared/paths'
import type { RecordTypes } from '@shared/records'
import { recordTitle } from '../../lib/recordTitle'
import { resolveRemote, useJournal } from '../../store/journal'
import { setRemoteDialog, useRemote, type PendingRemote } from '../../store/remote'
import { Modal } from '../../components/Modal'
import { Badge, Segmented, cx } from '../../components/ui'
import { ChangeList, displayValue, useDictNames } from '../history/HistoryDialog'

type Choice = 'merge' | Side

function theirsRecord(item: PendingRemote): unknown {
  if (!item.theirs) return null
  return item.collection === 'journal' ? item.theirs : (item.theirs as RecordEntry<RecordTypes[Collection]>).record
}

function useMine(item: PendingRemote): unknown {
  return useJournal((s) => (item.collection === 'journal' ? s.journal : ((s[item.collection] as Record<string, RecordEntry<unknown>>)[item.id]?.record ?? null)))
}

function machineOf(item: PendingRemote): string {
  const r = theirsRecord(item) as { updatedBy?: string | null } | null
  return r?.updatedBy ?? 'inny komputer'
}

function ItemCard({ item, choice, onChoice, fields, onField }: { item: PendingRemote; choice: Choice; onChoice: (c: Choice) => void; fields: Record<string, Side>; onField: (k: string, s: Side) => void }) {
  const mine = useMine(item)
  const theirs = theirsRecord(item)
  const names = useDictNames()
  const title = recordTitle(item.collection, mine ?? theirs)
  const machine = machineOf(item)
  const remoteChanges = useMemo(() => (item.base !== undefined && theirs ? diffRecords(item.base, theirs) : theirs && mine ? diffRecords(mine, theirs) : []), [item.base, theirs, mine])
  const localChanges = useMemo(() => (item.hadLocalEdits && item.base !== undefined && mine ? diffRecords(item.base, mine) : []), [item, mine])
  const conflicts = useMemo(() => (theirs && mine && item.hadLocalEdits ? merge3(item.base, mine, theirs).conflicts : []), [item, mine, theirs])

  if (item.type === 'removal') {
    return (
      <div className="flex flex-col gap-2 border border-line p-2.5" data-testid="remote-item" data-type="removal">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-fg-strong">{title}</span>
          <Badge tone="warn">usunięty na innym komputerze</Badge>
          {item.hadLocalEdits && <Badge tone="accent">masz niezapisane zmiany</Badge>}
        </div>
        <Segmented
          size="sm"
          value={choice === 'merge' ? 'mine' : choice}
          onChange={(v) => onChoice(v)}
          options={[
            { value: 'theirs', label: 'Usuń też tutaj' },
            { value: 'mine', label: 'Zachowaj (przywróć plik)' }
          ]}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 border border-line p-2.5" data-testid="remote-item" data-type="update">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-fg-strong">{title}</span>
        <Badge>z komputera {machine}</Badge>
        {item.hadLocalEdits ? <Badge tone="accent">masz niezapisane zmiany ({localChanges.length})</Badge> : <Badge>bez Twoich zmian</Badge>}
        {conflicts.length > 0 && <Badge tone="warn">to samo pole zmienione po obu stronach: {conflicts.length}</Badge>}
      </div>
      <Segmented
        size="sm"
        value={choice}
        onChange={onChoice}
        options={
          item.hadLocalEdits
            ? [
                { value: 'merge', label: 'Scal' },
                { value: 'mine', label: 'Zachowaj moją' },
                { value: 'theirs', label: `Weź z ${machine}` }
              ]
            : [
                { value: 'theirs', label: 'Przyjmij zmiany' },
                { value: 'mine', label: 'Zachowaj moją wersję' }
              ]
        }
      />
      {choice === 'merge' && conflicts.length > 0 && (
        <div className="border border-accent/40 text-[11.5px]" data-testid="remote-conflicts">
          <div className="grid grid-cols-[170px_1fr_1fr] gap-2 border-b border-line bg-raised px-2 py-1 text-[10.5px] tracking-wide text-muted uppercase">
            <span>Pole</span>
            <span>Moja wersja</span>
            <span>Z {machine}</span>
          </div>
          {conflicts.map((c) => {
            const k = pathKey(c.path)
            const side = fields[k] ?? 'mine'
            return (
              <div key={k} className="grid grid-cols-[170px_1fr_1fr] items-center gap-2 border-b border-line/60 px-2 py-0.5 last:border-b-0" data-testid="remote-conflict">
                <span className="truncate text-muted">{fieldLabel(c.path)}</span>
                {(['mine', 'theirs'] as const).map((s) => (
                  <button
                    key={s}
                    className={cx('truncate border px-1.5 py-0.5 text-left', side === s ? 'border-accent bg-accent-soft text-fg-strong' : 'border-line hover:bg-hover')}
                    onClick={() => onField(k, s)}
                    data-testid={`remote-pick-${s}`}
                  >
                    {displayValue(s === 'mine' ? c.mine : c.theirs, names)}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <details>
        <summary className="cursor-default text-[11.5px] text-muted">Zmiany z {machine}: {remoteChanges.length}</summary>
        <div className="mt-1">
          <ChangeList changes={remoteChanges} beforeLabel="Było" afterLabel={`Z ${machine}`} />
        </div>
      </details>
    </div>
  )
}

/** Changes from another computer waiting for a decision (store/remote.ts); mounted once in the app shell. */
export function RemoteChangesDialog() {
  const pending = useRemote((s) => s.pending)
  const open = useRemote((s) => s.open)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [fields, setFields] = useState<Record<string, Record<string, Side>>>({})
  if (!open || pending.length === 0) return null
  const choiceOf = (p: PendingRemote): Choice => choices[p.key] ?? (p.hadLocalEdits ? 'merge' : p.type === 'removal' ? 'theirs' : 'theirs')
  const apply = () => {
    for (const p of pending) resolveRemote(p.key, choiceOf(p), fields[p.key] ?? {})
    setChoices({})
    setFields({})
  }
  return (
    <Modal
      title={`Zmiany z drugiego komputera (${pending.length})`}
      onClose={() => setRemoteDialog(false)}
      width={920}
      testId="remote-dialog"
      footer={
        <>
          <span className="text-[11.5px] text-muted">
            Wybrana do odrzucenia wersja nie ginie – jest w historii wpisu. Dopóki nie zdecydujesz, te wpisy nie są zapisywane.
          </span>
          <button className="btn btn-ghost ml-auto" onClick={() => setRemoteDialog(false)}>
            Później
          </button>
          <button className="btn btn-accent" onClick={apply} data-testid="remote-apply">
            Zastosuj
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-[11.5px] text-muted">
          Ten folder danych zmienił się na innym komputerze, gdy był otwarty tutaj. „Scal” łączy zmiany z obu komputerów (pola zmienione po obu stronach –
          według Twojego wyboru), „Zachowaj moją” zapisuje wersję z tego komputera, „Weź z…” przyjmuje wersję z drugiego.
        </p>
        {pending.map((p) => (
          <ItemCard
            key={p.key}
            item={p}
            choice={choiceOf(p)}
            onChoice={(c) => setChoices((x) => ({ ...x, [p.key]: c }))}
            fields={fields[p.key] ?? {}}
            onField={(k, s) => setFields((x) => ({ ...x, [p.key]: { ...(x[p.key] ?? {}), [k]: s } }))}
          />
        ))}
      </div>
    </Modal>
  )
}

/** Top-bar chip while decisions wait (the dialog was put off with "Później"). */
export function RemoteChangesChip() {
  const count = useRemote((s) => s.pending.length)
  const open = useRemote((s) => s.open)
  if (!count || open) return null
  return (
    <button className="btn h-[22px] border-accent/60 text-accent" onClick={() => setRemoteDialog(true)} data-testid="remote-chip">
      Zmiany z drugiego komputera: {count}
    </button>
  )
}

