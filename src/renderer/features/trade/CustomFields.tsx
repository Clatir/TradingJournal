import { withCustomValue } from '@shared/journalView'
import type { CustomField, Trade } from '@shared/schema'
import { useJournal } from '../../store/journal'
import { navigate } from '../../store/ui'
import { Field, NumberField, Segmented, TextField } from '../../components/ui'

/** Fields shown in the editor: active ones, plus archived ones that still hold a value on this trade. */
export function editorFields(fields: readonly CustomField[], trade: Trade): CustomField[] {
  return fields.filter((f) => !f.archived || trade.custom[f.id] != null)
}

function FieldInput({ field, trade, onChange }: { field: CustomField; trade: Trade; onChange: (fn: (t: Trade) => Trade) => void }) {
  const value = trade.custom[field.id]
  const set = (v: unknown) => onChange((t) => withCustomValue(t, field, v))
  switch (field.type) {
    case 'number':
      return <NumberField className="w-[90px]" value={typeof value === 'number' ? value : null} onChange={set} aria-label={field.name} data-testid={`cf-${field.name}`} />
    case 'check':
      return (
        <Segmented
          size="sm"
          value={value === true ? 'yes' : value === false ? 'no' : null}
          onChange={(v) => set(v === (value === true ? 'yes' : value === false ? 'no' : null) ? null : v === 'yes')}
          options={[
            { value: 'yes', label: 'Tak' },
            { value: 'no', label: 'Nie' }
          ]}
          aria-label={field.name}
        />
      )
    case 'select': {
      const options = field.options.filter((o) => !o.archived || o.id === value)
      if (!options.length) return <span className="text-[11.5px] text-dim">Brak opcji – dodaj je w Ustawienia → Słowniki.</span>
      return (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={field.name}>
          {options.map((o) => (
            <button key={o.id} type="button" className="chip" role="radio" aria-checked={value === o.id} aria-pressed={value === o.id} onClick={() => set(value === o.id ? null : o.id)}>
              {o.name}
            </button>
          ))}
        </div>
      )
    }
    default:
      return <TextField value={typeof value === 'string' ? value : ''} onChange={set} aria-label={field.name} data-testid={`cf-${field.name}`} />
  }
}

/** Editor section with the user's own fields (Ustawienia → Słowniki → Własne pola transakcji). */
export function CustomFieldsEditor({ trade, onChange }: { trade: Trade; onChange: (fn: (t: Trade) => Trade) => void }) {
  const fields = useJournal((s) => s.journal?.settings.customFields)
  const shown = editorFields(fields ?? [], trade)
  if (!shown.length)
    return (
      <span className="text-[11.5px] text-dim">
        Brak własnych pól.{' '}
        <button className="underline hover:text-fg" onClick={() => navigate({ page: 'settings', tab: 'dictionaries' })}>
          Dodaj w ustawieniach
        </button>{' '}
        (np. ocena setupu A/B/C, liczba konfluencji).
      </span>
    )
  return (
    <div className="flex flex-col gap-1.5" data-testid="custom-fields">
      {shown.map((f) => (
        <Field key={f.id} label={f.archived ? `${f.name} (archiwum)` : f.name}>
          <FieldInput field={f} trade={trade} onChange={onChange} />
        </Field>
      ))}
    </div>
  )
}
