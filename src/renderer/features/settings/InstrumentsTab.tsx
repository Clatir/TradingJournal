import { useState } from 'react'
import { stepDecimals } from '@shared/calc/position'
import { instrumentIdFromName, restoreDefaultInstruments } from '@shared/instruments'
import type { Instrument, Settings } from '@shared/schema'
import { toast } from '../../store/ui'
import { updateJournal } from '../../store/journal'
import { IconPlus } from '../../components/icons'
import { CurrencyInput, NameInput, NumberField, Panel, TextField, cx } from '../../components/ui'

const setSettings = (fn: (s: Settings) => Settings) => updateJournal((j) => ({ ...j, settings: fn(j.settings) }))
const setInstrument = (id: string, patch: Partial<Instrument>) =>
  setSettings((s) => ({ ...s, instruments: s.instruments.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))

const COLS = 'grid-cols-[96px_minmax(110px,1fr)_92px_100px_64px_84px_minmax(120px,1.4fr)_84px]'

/** A positive number or empty (null = "as in the risk settings"); zero and negatives are refused. */
const positiveOrNull = (v: number | null): number | null | undefined => (v == null ? null : v > 0 ? v : undefined)

/** Instruments of the P/L calculator and of the pip mode of the forecast (chapter 15). */
export function InstrumentsTab({ settings }: { settings: Settings }) {
  const [name, setName] = useState('')
  const risk = settings.risk
  const nameTaken = (n: string, except?: string) => settings.instruments.some((i) => i.id !== except && i.name.toLowerCase() === n.toLowerCase())

  const add = () => {
    const n = name.trim()
    const id = instrumentIdFromName(n)
    if (!/^[A-Z0-9]{2,16}$/.test(id)) return toast('Nazwa instrumentu musi mieć co najmniej 2 litery lub cyfry, np. XAUUSD.', 'error')
    if (settings.instruments.some((i) => i.id === id)) return toast(`Instrument o identyfikatorze ${id} już jest na liście.`, 'error')
    if (nameTaken(n)) return toast(`„${n}” już jest na liście.`, 'error')
    setSettings((s) => ({
      ...s,
      instruments: [...s.instruments, { id, name: n.slice(0, 24), pipSize: null, contractSize: null, quoteCurrency: null, minLot: null, description: '', archived: false }]
    }))
    setName('')
  }

  return (
    <Panel title="Instrumenty">
      <div className="overflow-x-auto" data-testid="instruments">
        <div className="min-w-[860px]">
          <div className={cx('grid items-center gap-2 border-b border-line/70 py-1 text-[10.5px] tracking-wide text-muted uppercase', COLS)}>
            <span>Identyfikator</span>
            <span>Nazwa</span>
            <span>Wielkość pipsa</span>
            <span>Jednostek / 1 lot</span>
            <span>Waluta</span>
            <span>Najmn. lot</span>
            <span>Opis</span>
            <span />
          </div>
          {settings.instruments.map((i) => (
            <div key={i.id} className={cx('grid items-center gap-2 border-b border-line/70 py-1', COLS, i.archived && 'opacity-50')} data-testid={`inst-row-${i.id}`}>
              <span className="num truncate text-fg-strong" title="Identyfikator się nie zmienia – pod nim są zapisane ręczne wartości pipsa">
                {i.id}
              </span>
              <NameInput
                value={i.name}
                maxLength={24}
                onChange={(v) => setInstrument(i.id, { name: v })}
                validate={(v) => (nameTaken(v, i.id) ? `„${v}” już jest na liście.` : null)}
                aria-label={`Nazwa instrumentu ${i.id}`}
                data-testid={`inst-name-${i.id}`}
              />
              <NumberField
                value={i.pipSize}
                onChange={(v) => {
                  const next = positiveOrNull(v)
                  if (next !== undefined) setInstrument(i.id, { pipSize: next })
                }}
                placeholder="tylko ręcznie"
                aria-label={`Wielkość pipsa ${i.id}`}
                data-testid={`inst-pip-${i.id}`}
              />
              <NumberField
                value={i.contractSize}
                onChange={(v) => {
                  const next = positiveOrNull(v)
                  if (next !== undefined) setInstrument(i.id, { contractSize: next })
                }}
                decimals={i.contractSize != null ? Math.min(4, stepDecimals(i.contractSize)) : undefined}
                placeholder={risk.contractSize.toLocaleString('pl-PL')}
                aria-label={`Jednostek na 1 lot ${i.id}`}
                data-testid={`inst-contract-${i.id}`}
              />
              <CurrencyInput
                value={i.quoteCurrency ?? ''}
                allowEmpty
                placeholder={risk.accountCurrency}
                onChange={(v) => setInstrument(i.id, { quoteCurrency: v || null })}
                aria-label={`Waluta wartości pipsa ${i.id}`}
                data-testid={`inst-quote-${i.id}`}
              />
              <NumberField
                value={i.minLot}
                onChange={(v) => {
                  const next = positiveOrNull(v)
                  if (next !== undefined) setInstrument(i.id, { minLot: next })
                }}
                placeholder={String(risk.lotStep)}
                aria-label={`Najmniejszy lot ${i.id}`}
                data-testid={`inst-minlot-${i.id}`}
              />
              <TextField value={i.description} onChange={(v) => setInstrument(i.id, { description: v })} aria-label={`Opis ${i.id}`} data-testid={`inst-desc-${i.id}`} />
              <button className="btn h-[22px]" onClick={() => setInstrument(i.id, { archived: !i.archived })} data-testid={`inst-archive-${i.id}`}>
                {i.archived ? 'Przywróć' : 'Archiwizuj'}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <TextField
          className="w-[180px]"
          value={name}
          onChange={(v) => setName(v.slice(0, 24))}
          placeholder="np. XAUUSD, US30, DAX"
          aria-label="Nazwa nowego instrumentu"
          data-testid="inst-add-name"
        />
        <button className="btn" onClick={add} data-testid="inst-add">
          <IconPlus size={13} /> Dodaj instrument
        </button>
        <button className="btn ml-auto" onClick={() => setSettings((s) => ({ ...s, instruments: restoreDefaultInstruments(s.instruments) }))} data-testid="inst-restore">
          Przywróć domyślne
        </button>
      </div>
      <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] text-muted">
        <li>
          Wartość pipsa najmniejszego lota = wielkość pipsa × jednostek na 1 lot × najmniejszy lot, w walucie instrumentu, przeliczona kursem na walutę konta
          (albo walutę scenariusza prognozy).
        </li>
        <li>
          Puste pola biorą wartości z ustawień ryzyka: jednostek na 1 lot = wielkość lota ({risk.contractSize.toLocaleString('pl-PL')}), najmniejszy lot = krok
          lota ({risk.lotStep}), waluta = waluta konta ({risk.accountCurrency}). Pusta wielkość pipsa = wartość pipsa tylko wpisana ręcznie.
        </li>
        <li>Wartość pipsa wpisana ręcznie w kalkulatorze zysku / straty ma pierwszeństwo przed wyliczoną.</li>
        <li>Zarchiwizowany instrument znika z wyboru; scenariusze prognozy, które go używają, nadal go pokazują.</li>
      </ul>
    </Panel>
  )
}
