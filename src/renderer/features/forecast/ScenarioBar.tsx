import { useState } from 'react'
import type { Forecast } from '@shared/schema'
import { useJournal } from '../../store/journal'
import { navigate } from '../../store/ui'
import { Badge, NameInput, TextArea, cx } from '../../components/ui'
import { createScenario, deleteScenario, duplicateScenario, updateScenario } from './actions'
import { sortedScenarios, useForecastSession } from './session'

/** Scenario bar (chapter 12): list, name, new / duplicate / delete, compare with, notes. */
export function ScenarioBar({ scenario, readOnly, fileReadOnly, folderReadOnly }: { scenario: Forecast; readOnly: boolean; fileReadOnly: boolean; folderReadOnly: boolean }) {
  const forecasts = useJournal((s) => s.forecasts)
  const compareId = useForecastSession((s) => s.compareId)
  const [confirm, setConfirm] = useState(false)
  const [notesOpen, setNotesOpen] = useState(!!scenario.notes)
  const list = sortedScenarios(forecasts)
  const others = list.filter((f) => f.id !== scenario.id)
  const taken = (name: string) => list.some((f) => f.id !== scenario.id && f.name.toLowerCase() === name.toLowerCase())

  return (
    <div className="flex flex-col gap-1.5 pt-3" data-testid="fc-header">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input w-[220px]"
          value={scenario.id}
          onChange={(e) => {
            setConfirm(false)
            navigate({ page: 'forecast', id: e.currentTarget.value })
          }}
          aria-label="Scenariusz"
          data-testid="fc-scenario"
        >
          {list.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <NameInput
          key={scenario.id}
          value={scenario.name}
          maxLength={60}
          className="w-[240px] font-medium"
          emptyMessage="Nazwa scenariusza nie może być pusta."
          validate={(v) => (taken(v) ? `Scenariusz „${v}” już jest.` : null)}
          onChange={(name) => updateScenario(scenario.id, (f) => ({ ...f, name }))}
          aria-label="Nazwa scenariusza"
          data-testid="fc-name"
        />
        <span className="num text-[11.5px] text-muted">{scenario.currency}</span>
        {fileReadOnly && <Badge tone="warn">nowszy format – tylko odczyt</Badge>}
        <button className="btn" disabled={folderReadOnly} onClick={() => createScenario()} data-testid="fc-new">
          Nowy
        </button>
        <button className="btn" disabled={readOnly} onClick={() => duplicateScenario(scenario.id)} title="Duplikuj scenariusz (Ctrl+Shift+D)" data-testid="fc-duplicate">
          Duplikuj
        </button>
        {confirm ? (
          <span className="flex items-center gap-1.5 text-[12px]" data-testid="fc-delete-question">
            <span>Usunąć scenariusz „{scenario.name}”?</span>
            <button
              className="btn border-down/60 text-down"
              onClick={() => {
                setConfirm(false)
                void deleteScenario(scenario.id)
              }}
              data-testid="fc-delete-confirm"
            >
              Usuń
            </button>
            <button className="btn" onClick={() => setConfirm(false)} data-testid="fc-delete-cancel">
              Anuluj
            </button>
          </span>
        ) : (
          <button className="btn" disabled={readOnly} onClick={() => setConfirm(true)} data-testid="fc-delete">
            Usuń
          </button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          Porównaj z…
          <select
            className="input w-[200px]"
            value={compareId && others.some((f) => f.id === compareId) ? compareId : ''}
            onChange={(e) => useForecastSession.setState({ compareId: e.currentTarget.value || null })}
            aria-label="Porównaj z"
            data-testid="fc-compare"
          >
            <option value="">—</option>
            {others.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <button
          className={cx('self-start text-[11.5px] hover:text-fg-strong', scenario.notes ? 'text-fg' : 'text-muted')}
          onClick={() => setNotesOpen((o) => !o)}
          aria-expanded={notesOpen}
          data-testid="fc-notes-toggle"
        >
          {notesOpen ? '▾' : '▸'} Notatki{!notesOpen && scenario.notes ? ` – ${scenario.notes.split('\n')[0]!.slice(0, 80)}` : ''}
        </button>
        {notesOpen && (
          <TextArea
            value={scenario.notes}
            onChange={(notes) => updateScenario(scenario.id, (f) => ({ ...f, notes }))}
            placeholder="Założenia, skąd te liczby, co chcesz sprawdzić…"
            rows={2}
            aria-label="Notatki scenariusza"
            data-testid="fc-notes"
          />
        )}
      </div>
    </div>
  )
}
