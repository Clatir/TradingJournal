import { useEffect, useRef, useState } from 'react'
import { applyTemplate, templateFromPlan } from '@shared/dayTemplates'
import type { DayPlan } from '@shared/schema'
import { updateJournal, updateRecord, useJournal } from '../../store/journal'
import { toast } from '../../store/ui'
import { ensureDayPlan } from '../sessions/actions'
import { cx } from '../../components/ui'

/** Insert template `id` into the plan of `date` (created when missing). */
export function insertTemplate(id: string, date: string): void {
  const t = useJournal.getState().journal?.settings.dayTemplates.find((x) => x.id === id)
  const dayId = ensureDayPlan(date)
  if (!t || !dayId) return
  updateRecord('days', dayId, (p: DayPlan) => applyTemplate(p, t))
  toast(`Wstawiono szablon „${t.name}”.`, 'success')
}

/** Day plan header: insert a template, save the plan as one, choose the default, delete. */
export function TemplatesMenu({ plan, readOnly }: { plan: DayPlan; readOnly: boolean }) {
  const templates = useJournal((s) => s.journal?.settings.dayTemplates ?? [])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const setTemplates = (fn: (t: typeof templates) => typeof templates) =>
    updateJournal((j) => ({ ...j, settings: { ...j.settings, dayTemplates: fn(j.settings.dayTemplates) } }))
  return (
    <div className="relative" ref={ref}>
      <button className="btn h-[22px]" disabled={readOnly} onClick={() => setOpen((o) => !o)} data-testid="template-menu">
        Szablon ▾
      </button>
      {open && (
        <div className="absolute top-[26px] left-0 z-40 flex w-[380px] animate-pop-in flex-col gap-2 border border-line-strong bg-panel p-2.5 text-[12px]" data-testid="template-panel">
          {templates.length === 0 ? (
            <span className="text-muted">Brak szablonów – zapisz ten plan jako pierwszy.</span>
          ) : (
            <div className="flex flex-col">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-1.5 border-b border-line/60 py-1 last:border-b-0" data-testid="template-row">
                  <span className="min-w-0 flex-1 truncate" title={`${t.pairs.map((p) => p.pair).join(', ')}${t.intermarket.length ? ` · ${t.intermarket.join(', ')}` : ''}`}>
                    {t.name}
                    <span className="ml-1.5 text-[11px] text-dim">{t.pairs.map((p) => p.pair).join(' ')}</span>
                  </span>
                  <button
                    className={cx('btn h-[22px] px-1.5', t.isDefault && 'border-accent/60 text-accent')}
                    title={t.isDefault ? 'Domyślny dla nowych planów (kliknij, żeby wyłączyć)' : 'Ustaw jako domyślny dla nowych planów'}
                    onClick={() => setTemplates((xs) => xs.map((x) => ({ ...x, isDefault: x.id === t.id ? !t.isDefault : false })))}
                    data-testid="template-default"
                  >
                    {t.isDefault ? '★' : '☆'}
                  </button>
                  <button
                    className="btn h-[22px]"
                    onClick={() => {
                      updateRecord('days', plan.id, (p: DayPlan) => applyTemplate(p, t))
                      toast(`Wstawiono szablon „${t.name}” (puste pola uzupełnione, wpisane zostają).`, 'success')
                      setOpen(false)
                    }}
                    data-testid="template-apply"
                  >
                    Wstaw
                  </button>
                  {confirm === t.id ? (
                    <button className="btn h-[22px] border-down/60 text-down" onClick={() => setTemplates((xs) => xs.filter((x) => x.id !== t.id))}>
                      Usuń
                    </button>
                  ) : (
                    <button className="btn btn-ghost h-[22px] px-1 hover:text-down" onClick={() => setConfirm(t.id)} title="Usuń szablon">
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 border-t border-line pt-2">
            <input className="input h-[24px] flex-1" value={name} placeholder="nazwa, np. London + NY" onChange={(e) => setName(e.currentTarget.value)} data-testid="template-name" />
            <button
              className="btn btn-accent h-[24px]"
              disabled={!name.trim()}
              onClick={() => {
                if (templates.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) {
                  toast('Szablon o tej nazwie już jest.', 'error')
                  return
                }
                setTemplates((xs) => [...xs, templateFromPlan(plan, name)])
                toast(`Zapisano szablon „${name.trim()}”: pary, DOL, scenariusze, etykiety poziomów, intermarket i notatki.`, 'success')
                setName('')
              }}
              data-testid="template-save"
            >
              Zapisz ten plan jako szablon
            </button>
          </div>
          <span className="text-[11px] text-muted">
            Szablon nie zawiera biasu, cen poziomów, newsów ani screenów. Wstawienie uzupełnia tylko puste pola. Domyślny (★) zakłada każdy nowy plan.
          </span>
        </div>
      )}
    </div>
  )
}
