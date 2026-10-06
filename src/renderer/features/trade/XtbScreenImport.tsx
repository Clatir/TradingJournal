import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import {
  applyScreenValues,
  changedScreenFields,
  ocrTime,
  screenValues,
  warsawText,
  xtbMissing,
  xtbWarnings,
  type ScreenFieldKey,
  type ScreenValues,
  type XtbPosition
} from '@shared/import/xtbScreen'
import { brokerTimeToUtc } from '@shared/import/match'
import { lotDecimals } from '@shared/calc/position'
import type { Trade } from '@shared/schema'
import { errorMessage } from '../../lib/api'
import { fmtMoney } from '../../lib/format'
import { imageFilesFrom } from '../../lib/image'
import { readXtbScreenshot } from '../../lib/ocr'
import { updateRecord, useJournal } from '../../store/journal'
import { toast } from '../../store/ui'
import { Modal } from '../../components/Modal'
import { IconImage } from '../../components/icons'
import { NumberField, cx } from '../../components/ui'

const DIRECTION = { long: 'Long (Buy)', short: 'Short (Sell)' } as const

/** Button in the trade editor: fill the trade from a screenshot of XTB's position details. */
export function XtbScreenButton({ trade, disabled }: { trade: Trade; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="btn" disabled={disabled} onClick={() => setOpen(true)} title="Uzupełnij transakcję ze screenu „Szczegóły pozycji” z XTB (OCR offline, screen nie jest zapisywany)" data-testid="xtb-open">
        <IconImage size={13} /> Ze screenu XTB
      </button>
      {open && <XtbScreenDialog trade={trade} onClose={() => setOpen(false)} />}
    </>
  )
}

type Phase = { kind: 'wait' } | { kind: 'reading'; pass: number; total: number } | { kind: 'done' } | { kind: 'error'; message: string }

function XtbScreenDialog({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const journal = useJournal((s) => s.journal)!
  const settings = journal.settings
  const currency = settings.risk.accountCurrency
  const pairs = settings.pairs.map((p) => p.symbol)
  const [phase, setPhase] = useState<Phase>({ kind: 'wait' })
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [position, setPosition] = useState<XtbPosition | null>(null)
  const [values, setValues] = useState<ScreenValues | null>(null)
  const [selected, setSelected] = useState<Set<ScreenFieldKey>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const run = useRef(0)

  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl])

  const read = useCallback(
    async (file: Blob) => {
      const token = ++run.current
      setImageUrl(URL.createObjectURL(file))
      setPosition(null)
      setValues(null)
      setPhase({ kind: 'reading', pass: 1, total: 1 })
      try {
        const p = await readXtbScreenshot(file, (pass, total) => token === run.current && setPhase({ kind: 'reading', pass, total }))
        if (token !== run.current) return
        if (!p) {
          setPhase({ kind: 'error', message: 'Nie rozpoznano panelu „Szczegóły pozycji” – wklej screen całego okna pozycji z XTB.' })
          return
        }
        const v = screenValues(p, pairs)
        const changed = changedScreenFields(trade, v, currency)
        // Replacing several partial exits or reinterpreting a risk amount typed in another currency is opt-in.
        const riskInOther = trade.riskAmount != null && (trade.amountCurrency ?? settings.risk.legacyAmountCurrency ?? currency) !== currency
        setPosition(p)
        setValues(v)
        setSelected(new Set(changed.filter((k) => !(k === 'exit' && trade.exits.length > 1) && !(k === 'result' && riskInOther))))
        setPhase({ kind: 'done' })
      } catch (e) {
        if (token === run.current) setPhase({ kind: 'error', message: `OCR nie powiódł się: ${errorMessage(e)}` })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trade, currency]
  )

  // Ctrl+V while the dialog is open reads the image (and is not taken by the editor's screens panel).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData)
      e.stopPropagation()
      if (!files.length) return
      e.preventDefault()
      void read(files[0]!)
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [read])

  const set = (patch: Partial<ScreenValues>, key: ScreenFieldKey) => {
    setValues((v) => (v ? { ...v, ...patch } : v))
    setSelected((s) => new Set(s).add(key))
  }
  const toggle = (key: ScreenFieldKey) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const apply = () => {
    if (!values || selected.size === 0) return
    updateRecord('trades', trade.id, (t) => applyScreenValues(t, values, selected, { currency, symbol: position?.symbol ?? null, now: new Date().toISOString() }))
    toast(`Uzupełniono ze screenu XTB: ${selected.size} ${selected.size === 1 ? 'pole' : selected.size < 5 ? 'pola' : 'pól'}.`, 'success')
    onClose()
  }

  const pairCfg = settings.pairs.find((p) => p.symbol === (values?.pair ?? trade.pair))
  const decimals = pairCfg?.priceDecimals ?? 5
  const price = (v: number | null) => (v == null ? '—' : v.toFixed(decimals))
  const missing = position ? xtbMissing(position) : []
  const warnings = position ? xtbWarnings(position) : []
  const riskInOther = trade.riskAmount != null && (trade.amountCurrency ?? settings.risk.legacyAmountCurrency ?? currency) !== currency

  const row = (key: ScreenFieldKey, label: string, input: ReactNode, current: ReactNode, note?: ReactNode, available = true) => (
    <div key={key} className={cx('grid grid-cols-[22px_150px_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-2 border-b border-line/60 px-2 py-1 last:border-b-0', !available && 'opacity-50')} data-testid={`xtb-row-${key}`}>
      <input type="checkbox" checked={selected.has(key)} disabled={!available} onChange={() => toggle(key)} aria-label={`Użyj: ${label}`} data-testid={`xtb-use-${key}`} />
      <span className="text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {input}
        {note && <span className="text-[11px] text-accent">{note}</span>}
      </div>
      <span className="num truncate text-dim" title="Obecnie w transakcji">
        {current}
      </span>
    </div>
  )

  return (
    <Modal
      title="Uzupełnij ze screenu XTB"
      onClose={onClose}
      width={900}
      testId="xtb-dialog"
      footer={
        <>
          <span className="flex-1 text-[11px] text-dim">Odczyt offline na tym komputerze. Screen nie jest zapisywany.</span>
          <button className="btn" onClick={onClose}>
            Anuluj
          </button>
          <button className="btn btn-accent" disabled={!values || selected.size === 0} onClick={apply} data-testid="xtb-apply">
            Uzupełnij transakcję ({selected.size})
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <div
          className={cx('flex w-[300px] shrink-0 flex-col items-center justify-center gap-2 border border-dashed p-2 text-center text-[12px] text-muted', dragOver ? 'border-accent' : 'border-line-strong')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = imageFilesFrom(e.dataTransfer)[0]
            if (f) void read(f)
          }}
          data-testid="xtb-drop"
        >
          {imageUrl ? <img src={imageUrl} alt="Wklejony screen" className="max-h-[260px] max-w-full object-contain" /> : null}
          <span>
            Wklej screen <kbd className="kbd">Ctrl+V</kbd>, przeciągnij plik albo{' '}
            <button className="text-accent underline-offset-2 hover:underline" onClick={() => fileInput.current?.click()}>
              wybierz z dysku
            </button>
            .
          </span>
          <span className="text-[11px] text-dim">XTB → Historia → pozycja → „Szczegóły pozycji”. Czasy XTB są w czasie warszawskim.</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (f) void read(f)
            }}
            data-testid="xtb-file"
          />
        </div>

        <div className="min-w-0 flex-1 text-[12px]">
          {phase.kind === 'wait' && <div className="py-6 text-center text-muted">Czekam na screen.</div>}
          {phase.kind === 'reading' && (
            <div className="py-6 text-center text-muted" data-testid="xtb-reading">
              Odczytuję screen…{phase.total > 1 && phase.pass > 1 ? ` (próba ${phase.pass} z ${phase.total})` : ''}
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="py-6 text-center text-down" data-testid="xtb-error">
              {phase.message}
            </div>
          )}
          {phase.kind === 'done' && values && position && (
            <div className="flex flex-col gap-2">
              <div className="border border-line" data-testid="xtb-values">
                <div className="grid grid-cols-[22px_150px_minmax(0,1fr)_minmax(0,0.8fr)] gap-2 border-b border-line bg-raised px-2 py-1 text-[10.5px] tracking-wide text-muted uppercase">
                  <span />
                  <span>Pole</span>
                  <span>Ze screenu (możesz poprawić)</span>
                  <span>Teraz w transakcji</span>
                </div>
                {row(
                  'pair',
                  'Para',
                  <select className="input h-[24px]" value={values.pair ?? ''} onChange={(e) => set({ pair: e.currentTarget.value || null }, 'pair')} data-testid="xtb-pair">
                    <option value="">{position.symbol ? `(${position.symbol} – brak w parach)` : '(nie odczytano)'}</option>
                    {pairs.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>,
                  trade.pair,
                  undefined,
                  values.pair != null
                )}
                {row(
                  'direction',
                  'Kierunek',
                  <select
                    className="input h-[24px]"
                    value={values.direction ?? ''}
                    onChange={(e) => set({ direction: (e.currentTarget.value || null) as ScreenValues['direction'] }, 'direction')}
                    data-testid="xtb-direction"
                  >
                    <option value="">(nie odczytano)</option>
                    <option value="long">{DIRECTION.long}</option>
                    <option value="short">{DIRECTION.short}</option>
                  </select>,
                  DIRECTION[trade.direction],
                  undefined,
                  values.direction != null
                )}
                {row(
                  'entryTime',
                  'Czas wejścia (WAW)',
                  <WawInput iso={values.entryTime} onChange={(v) => set({ entryTime: v }, 'entryTime')} testId="xtb-entry-time" />,
                  warsawText(trade.entryTime),
                  undefined,
                  values.entryTime != null
                )}
                {row(
                  'entry',
                  'Cena wejścia',
                  <NumberField className="w-[110px]" value={values.entry} onChange={(v) => set({ entry: v }, 'entry')} decimals={decimals} data-testid="xtb-entry" />,
                  price(trade.prices.entry),
                  undefined,
                  values.entry != null
                )}
                {row(
                  'stopLoss',
                  'Stop loss',
                  <NumberField className="w-[110px]" value={values.stopLoss} onChange={(v) => set({ stopLoss: v }, 'stopLoss')} decimals={decimals} data-testid="xtb-sl" />,
                  price(trade.prices.stopLoss),
                  undefined,
                  values.stopLoss != null
                )}
                {row(
                  'takeProfit',
                  'TP1 (Take Profit)',
                  <NumberField className="w-[110px]" value={values.takeProfit} onChange={(v) => set({ takeProfit: v }, 'takeProfit')} decimals={decimals} data-testid="xtb-tp" />,
                  price(trade.prices.takeProfit1),
                  undefined,
                  values.takeProfit != null
                )}
                {row(
                  'lots',
                  'Loty (wolumen)',
                  <NumberField className="w-[110px]" value={values.lots} onChange={(v) => set({ lots: v }, 'lots')} data-testid="xtb-lots" />,
                  trade.lots == null ? '—' : trade.lots.toFixed(lotDecimals(trade.lots)),
                  undefined,
                  values.lots != null
                )}
                {row(
                  'exit',
                  'Wyjście 100%',
                  <>
                    <NumberField className="w-[110px]" value={values.exitPrice} onChange={(v) => set({ exitPrice: v }, 'exit')} decimals={decimals} data-testid="xtb-exit-price" />
                    <WawInput iso={values.exitTime} onChange={(v) => set({ exitTime: v }, 'exit')} testId="xtb-exit-time" />
                  </>,
                  trade.exits
                    .filter((x) => x.price != null)
                    .map((x) => `${price(x.price)} (${x.percent}%)`)
                    .join(', ') || '—',
                  trade.exits.length > 1 ? `zastąpi ${trade.exits.length} wyjścia` : undefined,
                  values.exitPrice != null
                )}
                {row(
                  'result',
                  `Wynik netto (${currency})`,
                  <NumberField className="w-[110px]" value={values.result} onChange={(v) => set({ result: v }, 'result')} decimals={2} data-testid="xtb-result" />,
                  trade.pnlAmountOverride == null ? '—' : fmtMoney(trade.pnlAmountOverride, trade.amountCurrency ?? currency),
                  riskInOther ? `kwota ryzyka jest w ${trade.amountCurrency ?? settings.risk.legacyAmountCurrency} – zostanie uznana za ${currency}` : undefined,
                  values.result != null
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-muted" data-testid="xtb-extra">
                <span>
                  Instrument: <span className="num text-fg">{position.symbol ?? '—'}</span>
                </span>
                <span>
                  Zysk brutto: <span className="num">{position.gross == null ? '—' : position.gross.toFixed(2)}</span>
                </span>
                <span>
                  Prowizja: <span className="num">{position.commission == null ? '—' : position.commission.toFixed(2)}</span>
                </span>
                <span>
                  Swap + rolowanie: <span className="num">{values.swap == null ? '—' : values.swap.toFixed(2)}</span>
                </span>
                {position.margin != null && (
                  <span>
                    Depozyt: <span className="num">{position.margin.toFixed(2)}</span>
                  </span>
                )}
              </div>
              {missing.length > 0 && (
                <div className="text-[11.5px] text-accent" data-testid="xtb-missing">
                  Nie odczytano: {missing.join(', ')}.
                </div>
              )}
              {warnings.map((w) => (
                <div key={w} className="text-[11.5px] text-accent" data-testid="xtb-warning">
                  {w}
                </div>
              ))}
              <div className="text-[11px] text-dim">
                Zaznaczone pola zastąpią wartości w transakcji. Kwota wyniku jest w walucie konta z ustawień ({currency}); prowizja i swap trafiają do informacji od brokera.
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Warsaw date and time "dd.MM.yyyy HH:mm" (XTB's clock), stored as UTC. */
function WawInput({ iso, onChange, testId }: { iso: string | null; onChange: (iso: string | null) => void; testId?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (iso ? warsawText(iso) : '')
  const parse = (t: string) => {
    const wall = ocrTime(t)
    return wall ? brokerTimeToUtc(wall, 'Europe/Warsaw') : null
  }
  const invalid = draft != null && draft.trim() !== '' && parse(draft) == null
  return (
    <input
      className="input num w-[128px] px-1.5"
      value={shown}
      placeholder="dd.mm.rrrr gg:mm"
      aria-invalid={invalid}
      aria-label="Data i godzina WAW"
      spellCheck={false}
      data-testid={testId}
      title={iso ? `NY ${DateTime.fromISO(iso, { zone: 'America/New_York' }).toFormat('yyyy-MM-dd HH:mm')}` : undefined}
      onChange={(e) => {
        const t = e.currentTarget.value
        setDraft(t)
        const v = parse(t)
        if (v) onChange(v)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}
