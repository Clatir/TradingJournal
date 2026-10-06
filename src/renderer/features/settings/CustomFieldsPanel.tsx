import { useState } from 'react'
import { newId } from '@shared/ids'
import type { CustomField, CustomFieldType, JournalFile } from '@shared/schema'
import { updateJournal } from '../../store/journal'
import { toast } from '../../store/ui'
import { IconPlus } from '../../components/icons'
import { NameInput, Panel, Segmented, cx } from '../../components/ui'

const TYPES: Array<{ value: CustomFieldType; label: string; title: string }> = [
  { value: 'select', label: 'Lista', title: 'Wybór jednej opcji, np. ocena setupu A+ / A / B' },
  { value: 'number', label: 'Liczba', title: 'np. liczba konfluencji' },
  { value: 'check', label: 'Tak / nie', title: 'np. wejście zgodne z planem dnia' },
  { value: 'text', label: 'Tekst', title: 'krótka notatka' }
]

const setFields = (fn: (f: CustomField[]) => CustomField[]) => updateJournal((j) => ({ ...j, settings: { ...j.settings, customFields: fn(j.settings.customFields) } }))
const setField = (id: string, patch: Partial<CustomField>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))

function OptionsEditor({ field }: { field: CustomField }) {
  const [name, setName] = useState('')
  const add = () => {
    const n = name.trim()
    if (!n) return
    if (field.options.some((o) => o.name.toLowerCase() === n.toLowerCase())) return toast('Taka opcja już jest.', 'error')
    setField(field.id, { options: [...field.options, { id: newId(), name: n.slice(0, 40), archived: false }] })
    setName('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {field.options.map((o) => (
        <span key={o.id} className={cx('flex items-center border border-line-strong', o.archived && 'opacity-50')}>
          <NameInput
            className="h-[22px] w-[84px] border-0"
            value={o.name}
            maxLength={40}
            onChange={(n) => setField(field.id, { options: field.options.map((x) => (x.id === o.id ? { ...x, name: n } : x)) })}
            validate={(n) => (field.options.some((x) => x.id !== o.id && x.name.toLowerCase() === n.toLowerCase()) ? `„${n}” już jest.` : null)}
            aria-label={`Opcja ${o.name}`}
          />
          <button
            className="px-1 text-dim hover:text-fg-strong"
            title={o.archived ? 'Przywróć opcję' : 'Archiwizuj (zostaje w dawnych wpisach)'}
            onClick={() => setField(field.id, { options: field.options.map((x) => (x.id === o.id ? { ...x, archived: !x.archived } : x)) })}
          >
            {o.archived ? '↺' : '×'}
          </button>
        </span>
      ))}
      <input
        className="input h-[22px] w-[110px]"
        value={name}
        placeholder="nowa opcja"
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        onBlur={add}
        aria-label={`Nowa opcja: ${field.name}`}
        data-testid="cf-option-new"
      />
    </div>
  )
}

/** Ustawienia → Słowniki: the user's own fields of trades (editor section, journal columns, filters, analytics, CSV). */
export function CustomFieldsPanel({ journal }: { journal: JournalFile }) {
  const fields = journal.settings.customFields
  const [name, setName] = useState('')
  const [type, setType] = useState<CustomFieldType>('select')
  const add = () => {
    const n = name.trim().slice(0, 40)
    if (!n) return
    if (fields.some((f) => f.name.toLowerCase() === n.toLowerCase())) return toast(`Pole „${n}” już istnieje.`, 'error')
    setFields((fs) => [...fs, { id: newId(), name: n, type, options: [], archived: false }])
    setName('')
  }
  return (
    <Panel title="Własne pola transakcji" className="col-span-2">
      <div className="flex flex-col gap-1 text-[12px]" data-testid="cf-settings">
        {fields.length === 0 && <span className="text-muted">Dodaj pola, których brakuje w dzienniku – pojawią się w edytorze transakcji, jako kolumny listy, w filtrach i w analityce.</span>}
        {fields.map((f) => (
          <div key={f.id} className={cx('grid grid-cols-[180px_250px_minmax(0,1fr)_96px] items-start gap-2 border-b border-line/60 py-1.5', f.archived && 'opacity-50')} data-testid="cf-row">
            <NameInput
              value={f.name}
              maxLength={40}
              onChange={(n) => setField(f.id, { name: n })}
              validate={(n) => (fields.some((x) => x.id !== f.id && x.name.toLowerCase() === n.toLowerCase()) ? `Pole „${n}” już istnieje.` : null)}
              aria-label="Nazwa pola"
            />
            <Segmented
              size="sm"
              value={f.type}
              onChange={(t) => setField(f.id, { type: t })}
              options={TYPES.map((t) => ({ ...t, title: `${t.title}. Zmiana typu nie kasuje zapisanych wartości, ale niepasujące nie będą widoczne.` }))}
              aria-label={`Typ pola ${f.name}`}
            />
            {f.type === 'select' ? <OptionsEditor field={f} /> : <span className="pt-0.5 text-[11.5px] text-dim">{TYPES.find((t) => t.value === f.type)?.title}</span>}
            <button className="btn h-[22px]" onClick={() => setField(f.id, { archived: !f.archived })}>
              {f.archived ? 'Przywróć' : 'Archiwizuj'}
            </button>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2">
          <input
            className="input w-[200px]"
            value={name}
            maxLength={40}
            placeholder="np. Ocena setupu"
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            data-testid="cf-add-name"
          />
          <Segmented size="sm" value={type} onChange={setType} options={TYPES} aria-label="Typ nowego pola" />
          <button className="btn" onClick={add} data-testid="cf-add">
            <IconPlus size={13} /> Dodaj pole
          </button>
        </div>
      </div>
    </Panel>
  )
}
