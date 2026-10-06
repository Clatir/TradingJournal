import { useState } from 'react'
import { create } from 'zustand'
import { newId } from '@shared/ids'
import { EMPTY_FILTER, advancedCount, allColumns, filterOf, moveColumn, resolveColumns, sameFilter, toggleColumn } from '@shared/journalView'
import type { CustomCondition, CustomField, JournalFilter } from '@shared/schema'
import { parseDateInput } from '../../lib/format'
import { updateJournal, useJournal } from '../../store/journal'
import { toast } from '../../store/ui'
import { Popover } from '../../components/Popover'
import { NumberField, Segmented, cx } from '../../components/ui'

/** Filters of the journal list for this session (saved filters live in the journal settings). */
export const useJournalFilter = create<{ filter: JournalFilter }>(() => ({ filter: EMPTY_FILTER }))
export const setFilter = (patch: Partial<JournalFilter>) => useJournalFilter.setState((s) => ({ filter: { ...s.filter, ...patch } }))

function setCondition(fieldId: string, patch: Partial<CustomCondition>): void {
  const custom = useJournalFilter.getState().filter.custom
  const base: CustomCondition = custom.find((c) => c.fieldId === fieldId) ?? { fieldId, text: null, optionId: null, min: null, max: null, checked: null }
  setFilter({ custom: [...custom.filter((c) => c.fieldId !== fieldId), { ...base, ...patch }] })
}

function DateBox({ value, placeholder, onChange, testId }: { value: string | null; placeholder: string; onChange: (v: string | null) => void; testId?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input num w-[98px] text-center"
      value={draft ?? value ?? ''}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        if (draft != null) {
          const text = draft.trim()
          const date = text ? parseDateInput(text) : null
          if (!text || date) onChange(date)
        }
        setDraft(null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label={placeholder}
      data-testid={testId}
    />
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
      <span className="text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function CustomConditionField({ field, c }: { field: CustomField; c: CustomCondition | undefined }) {
  switch (field.type) {
    case 'text':
      return (
        <input
          className="input"
          value={c?.text ?? ''}
          placeholder="zawiera…"
          onChange={(e) => setCondition(field.id, { text: e.currentTarget.value || null })}
          aria-label={`${field.name}: zawiera`}
        />
      )
    case 'select':
      return (
        <select className="input" value={c?.optionId ?? ''} onChange={(e) => setCondition(field.id, { optionId: e.currentTarget.value || null })} aria-label={field.name}>
          <option value="">dowolna</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.archived ? ' (archiwum)' : ''}
            </option>
          ))}
        </select>
      )
    case 'check':
      return (
        <Segmented
          size="sm"
          value={c?.checked == null ? 'all' : c.checked ? 'yes' : 'no'}
          onChange={(v) => setCondition(field.id, { checked: v === 'all' ? null : v === 'yes' })}
          options={[
            { value: 'all', label: 'wszystkie' },
            { value: 'yes', label: 'tak' },
            { value: 'no', label: 'nie' }
          ]}
          aria-label={field.name}
        />
      )
    case 'number':
      return (
        <>
          <span className="text-dim">od</span>
          <NumberField className="w-[64px]" value={c?.min ?? null} onChange={(v) => setCondition(field.id, { min: v })} aria-label={`${field.name}: od`} />
          <span className="text-dim">do</span>
          <NumberField className="w-[64px]" value={c?.max ?? null} onChange={(v) => setCondition(field.id, { max: v })} aria-label={`${field.name}: do`} />
        </>
      )
  }
}

/** "Filtry": dates, result, rules, mistakes, model and the user's own fields. */
export function FiltersButton() {
  const filter = useJournalFilter((s) => s.filter)
  const journal = useJournal((s) => s.journal)
  const n = advancedCount(filter)
  const models = journal?.dictionaries.entryModels ?? []
  const fields = journal?.settings.customFields.filter((f) => !f.archived) ?? []
  return (
    <Popover label={n ? `Filtry (${n})` : 'Filtry'} active={n > 0} width={430} testId="filters-button" panelTestId="filters-panel">
      {() => (
        <>
          <Row label="Data NY">
            <DateBox value={filter.from} placeholder="od" onChange={(from) => setFilter({ from })} testId="filter-from" />
            <span className="text-dim">–</span>
            <DateBox value={filter.to} placeholder="do" onChange={(to) => setFilter({ to })} testId="filter-to" />
          </Row>
          <Row label="Wynik">
            <Segmented
              size="sm"
              value={filter.outcome}
              onChange={(outcome) => setFilter({ outcome })}
              options={[
                { value: 'all', label: 'wszystkie' },
                { value: 'win', label: 'zysk' },
                { value: 'loss', label: 'strata' },
                { value: 'breakeven', label: 'BE' }
              ]}
              aria-label="Wynik"
            />
          </Row>
          <Row label="Zasady">
            <Segmented
              size="sm"
              value={filter.compliance}
              onChange={(compliance) => setFilter({ compliance })}
              options={[
                { value: 'all', label: 'wszystkie' },
                { value: 'compliant', label: 'zgodne' },
                { value: 'broken', label: 'złamane' }
              ]}
              aria-label="Zasady"
            />
          </Row>
          <Row label="Błędy">
            <Segmented
              size="sm"
              value={filter.mistakes}
              onChange={(mistakes) => setFilter({ mistakes })}
              options={[
                { value: 'all', label: 'wszystkie' },
                { value: 'with', label: 'z błędem' },
                { value: 'without', label: 'bez błędów' }
              ]}
              aria-label="Błędy"
            />
          </Row>
          <Row label="Model">
            <select className="input" value={filter.modelId ?? ''} onChange={(e) => setFilter({ modelId: e.currentTarget.value || null })} aria-label="Model">
              <option value="">dowolny</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.archived ? ' (archiwum)' : ''}
                </option>
              ))}
            </select>
          </Row>
          {fields.length > 0 && <span className="label border-t border-line pt-2">Własne pola</span>}
          {fields.map((f) => (
            <Row key={f.id} label={f.name}>
              <CustomConditionField field={f} c={filter.custom.find((c) => c.fieldId === f.id)} />
            </Row>
          ))}
          <div className="flex items-center gap-2 border-t border-line pt-2">
            <span className="text-[11px] text-dim">{fields.length ? '' : 'Własne pola transakcji: Ustawienia → Słowniki.'}</span>
            <button className="btn ml-auto h-[22px]" onClick={() => useJournalFilter.setState({ filter: EMPTY_FILTER })} data-testid="filters-clear">
              Wyczyść wszystkie
            </button>
          </div>
        </>
      )}
    </Popover>
  )
}

/** Saved filters: apply with a click, save the current set under a name, delete. */
export function SavedFiltersMenu() {
  const filter = useJournalFilter((s) => s.filter)
  const saved = useJournal((s) => s.journal?.settings.savedFilters)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const list = saved ?? []
  const current = list.find((s) => sameFilter(s, filter)) ?? null
  const save = () => {
    const n = name.trim().slice(0, 40)
    if (!n) return
    const existing = list.find((s) => s.name.toLowerCase() === n.toLowerCase())
    updateJournal((j) => ({
      ...j,
      settings: {
        ...j.settings,
        savedFilters: existing
          ? j.settings.savedFilters.map((s) => (s.id === existing.id ? { ...filterOf(filter), id: s.id, name: s.name } : s))
          : [...j.settings.savedFilters, { ...filterOf(filter), id: newId(), name: n }]
      }
    }))
    toast(existing ? `Zaktualizowano filtr „${existing.name}”.` : `Zapisano filtr „${n}”.`, 'success')
    setName('')
  }
  return (
    <Popover
      label={current ? `★ ${current.name}` : 'Zapisane ▾'}
      title="Zapisane filtry"
      active={!!current}
      width={330}
      testId="saved-filters"
      panelTestId="saved-filters-panel"
    >
      {(close) => (
        <>
          {list.length === 0 ? (
            <span className="text-muted">Brak zapisanych filtrów. Ustaw filtry i zapisz je pod nazwą.</span>
          ) : (
            <div className="flex flex-col">
              {list.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 border-b border-line/60 py-1 last:border-b-0" data-testid="saved-filter-row">
                  <button
                    className={cx('min-w-0 flex-1 truncate text-left hover:text-fg-strong', current?.id === s.id && 'text-accent')}
                    onClick={() => {
                      useJournalFilter.setState({ filter: filterOf(s) })
                      close()
                    }}
                    data-testid="saved-filter-apply"
                  >
                    {s.name}
                  </button>
                  {confirm === s.id ? (
                    <button
                      className="btn h-[22px] border-down/60 text-down"
                      onClick={() => updateJournal((j) => ({ ...j, settings: { ...j.settings, savedFilters: j.settings.savedFilters.filter((x) => x.id !== s.id) } }))}
                    >
                      Usuń
                    </button>
                  ) : (
                    <button className="btn btn-ghost h-[22px] px-1 hover:text-down" disabled={readOnly} onClick={() => setConfirm(s.id)} title="Usuń filtr">
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 border-t border-line pt-2">
            <input
              className="input flex-1"
              value={name}
              maxLength={40}
              placeholder="nazwa bieżących filtrów"
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              disabled={readOnly}
              data-testid="saved-filter-name"
            />
            <button className="btn h-[24px]" disabled={readOnly || !name.trim()} onClick={save} data-testid="saved-filter-save">
              Zapisz
            </button>
          </div>
        </>
      )}
    </Popover>
  )
}

/** Columns of the list: show / hide and order (kept in the journal settings, the same on every computer). */
export function ColumnsMenu() {
  const view = useJournal((s) => s.journal?.settings.journalView.columns ?? null)
  const fields = useJournal((s) => s.journal?.settings.customFields)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const shown = resolveColumns(view, fields ?? [])
  const hidden = allColumns(fields ?? []).filter((c) => !shown.some((s) => s.id === c.id))
  const setColumns = (columns: string[] | null) => updateJournal((j) => ({ ...j, settings: { ...j.settings, journalView: { ...j.settings.journalView, columns } } }))
  const ids = shown.map((c) => c.id)
  return (
    <Popover label="Kolumny" title="Kolumny listy" align="right" width={300} testId="columns-button" panelTestId="columns-panel" disabled={readOnly}>
      {() => (
        <>
          <span className="label">Widoczne (kolejność)</span>
          <div className="flex max-h-[300px] flex-col overflow-y-auto">
            {shown.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1.5 py-0.5" data-testid="column-shown">
                <input type="checkbox" checked disabled={shown.length === 1} onChange={() => setColumns(toggleColumn(ids, c.id))} aria-label={`Pokaż ${c.label}`} />
                <span className={cx('min-w-0 flex-1 truncate', c.field && 'text-accent')} title={c.title}>
                  {c.label}
                </span>
                <button className="btn btn-ghost h-[20px] px-1" disabled={i === 0} onClick={() => setColumns(moveColumn(ids, c.id, -1))} title="Wyżej (w lewo)">
                  ↑
                </button>
                <button className="btn btn-ghost h-[20px] px-1" disabled={i === shown.length - 1} onClick={() => setColumns(moveColumn(ids, c.id, 1))} title="Niżej (w prawo)">
                  ↓
                </button>
              </div>
            ))}
          </div>
          {hidden.length > 0 && (
            <>
              <span className="label border-t border-line pt-2">Ukryte</span>
              <div className="flex max-h-[200px] flex-col overflow-y-auto">
                {hidden.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 py-0.5" data-testid="column-hidden">
                    <input type="checkbox" checked={false} onChange={() => setColumns(toggleColumn(ids, c.id))} aria-label={`Pokaż ${c.label}`} />
                    <span className={cx('min-w-0 flex-1 truncate', c.field && 'text-accent')} title={c.title}>
                      {c.label}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <button className="btn h-[22px] self-end" onClick={() => setColumns(null)} data-testid="columns-default">
            Domyślne
          </button>
        </>
      )}
    </Popover>
  )
}
