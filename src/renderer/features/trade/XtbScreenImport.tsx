import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import {
  applyScreenValues,
  changedScreenFields,
  expectedGross,
  matchInstrument,
  ocrTime,
  pairFromDescription,
  resultMismatch,
  screenValues,
  wallText,
  warsawText,
  xtbMissing,
  xtbWarnings,
  type PairMatch,
  type ScreenFieldKey,
  type ScreenValues,
  type VotedKey,
  type XtbPosition
} from '@shared/import/xtbScreen'
import { brokerTimeToUtc } from '@shared/import/match'
import { lotDecimals } from '@shared/calc/position'
import { rateFor } from '@shared/fx'
import { pairPreset } from '@shared/pairs'
import type { Settings, Trade } from '@shared/schema'
import { errorMessage } from '../../lib/api'
import { fmtMoney } from '../../lib/format'
import { imageFilesFrom } from '../../lib/image'
import { readXtbScreenshot } from '../../lib/ocr'
import { updateJournal, updateRecord, useJournal } from '../../store/journal'
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

type Phase = { kind: 'wait' } | { kind: 'reading'; step: string } | { kind: 'done' } | { kind: 'error'; message: string }

/** Values of a review row that the readings disagreed on. */
const UNCERTAIN_OF: Partial<Record<ScreenFieldKey, VotedKey[]>> = {
  direction: ['direction'],
  entryTime: ['openTime'],
  entry: ['openPrice'],
  stopLoss: ['stopLoss'],
  takeProfit: ['takeProfit'],
  lots: ['volume'],
  exit: ['closePrice', 'closeTime'],
  result: ['profit']
}

const otherText = (key: VotedKey, value: string) =>
  key === 'openTime' || key === 'closeTime' ? wallText(value) : key === 'direction' ? (value === 'long' ? 'Buy' : 'Sell') : value

/** A pair added from the dialog: the usual preset (oil, JPY…), the quote currency from XTB's description if read. */
function addPair(symbol: string, description: string | null) {
  const fromDesc = pairFromDescription(description)
  const quote = fromDesc?.slice(3) ?? (/^[A-Z]{6}$/.test(symbol) ? symbol.slice(3) : 'USD')
  const preset = pairPreset(symbol, quote)
  updateJournal((j) => ({
    ...j,
    settings: {
      ...j.settings,
      pairs: j.settings.pairs.some((p) => p.symbol === symbol)
        ? j.settings.pairs
        : [
            ...j.settings.pairs,
            {
              symbol,
              pipSize: preset.pipSize,
              priceDecimals: preset.priceDecimals,
              quoteCurrency: preset.quoteCurrency,
              tvSymbol: preset.tvSymbol,
              archived: false,
              contractSize: preset.contractSize
            }
          ]
    } satisfies Settings
  }))
  toast(`Dodano ${symbol} do par (pips ${preset.pipSize}, waluta ${preset.quoteCurrency}) – sprawdź w Ustawienia → Pary.`, 'success', 6000)
}

function XtbScreenDialog({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const journal = useJournal((s) => s.journal)!
  const settings = journal.settings
  const currency = settings.risk.accountCurrency
  const pairs = settings.pairs.map((p) => p.symbol)
  const [phase, setPhase] = useState<Phase>({ kind: 'wait' })
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [position, setPosition] = useState<XtbPosition | null>(null)
  const [values, setValues] = useState<ScreenValues | null>(null)
  const [match, setMatch] = useState<PairMatch | null>(null)
  const [newPair, setNewPair] = useState('')
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
      setPhase({ kind: 'reading', step: 'szukam pól' })
      try {
        const p = await readXtbScreenshot(file, (step) => token === run.current && setPhase({ kind: 'reading', step }))
        if (token !== run.current) return
        if (!p) {
          setPhase({ kind: 'error', message: 'Nie rozpoznano panelu „Szczegóły pozycji” – wklej screen całego okna pozycji z XTB.' })
          return
        }
        const v = screenValues(p, pairs)
        const m = matchInstrument(p, pairs)
        setMatch(m)
        setNewPair((m.read ?? '').replace(/[^A-Z0-9]/g, ''))
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
  // Result vs prices × volume (forex, or a pair with its lot size set): a misread digit shows up here.
  const checkPair = values?.pair ? settings.pairs.find((p) => p.symbol === values.pair) : null
  const checkable = checkPair && (checkPair.contractSize != null || /^[A-Z]{6}$/.test(checkPair.symbol))
  const rate = checkPair ? rateFor(checkPair.quoteCurrency, currency, settings) : null
  const expected = values && checkable && rate ? expectedGross(values, checkPair.contractSize ?? settings.risk.contractSize, rate.rate) : null
  const actualGross = position ? (position.gross ?? (position.profit != null ? position.profit - (position.commission ?? 0) - (position.swap ?? 0) - (position.rollover ?? 0) : null)) : null
  const mismatch = resultMismatch(actualGross, expected)

  /** "sprawdź – inne odczytanie: …" for a row whose value the readings disagreed on. */
  const doubt = (key: ScreenFieldKey): string | undefined => {
    const others = (UNCERTAIN_OF[key] ?? []).flatMap((k) => (position?.uncertain[k] ?? []).map((v) => otherText(k, v)))
    return others.length ? `sprawdź – inny odczyt: ${others.join(', ')}` : undefined
  }
  const pairNote =
    match?.how === 'similar'
      ? `odczytano „${match.read}” – dopasowano, sprawdź`
      : match?.how === 'description'
        ? `z opisu „${position?.description ?? ''}”${match.read ? ` (odczytano „${match.read}”)` : ''}`
        : undefined

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
              Odczytuję screen – {phase.step}…
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
                    <option value="">{match?.read ? `(${match.read} – brak w parach)` : '(nie odczytano)'}</option>
                    {settings.pairs.map((p) => p.symbol).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>,
                  trade.pair,
                  pairNote ??
                    (values.pair == null && newPair ? (
                      <span className="flex items-center gap-1 text-muted">
                        <input
                          className="input num h-[22px] w-[86px] px-1"
                          value={newPair}
                          onChange={(e) => setNewPair(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
                          aria-label="Symbol nowej pary"
                          data-testid="xtb-new-pair"
                        />
                        <button
                          className="btn h-[22px] px-1.5 text-[11px]"
                          disabled={newPair.length < 3}
                          onClick={() => {
                            addPair(newPair, position.description)
                            set({ pair: newPair }, 'pair')
                          }}
                          data-testid="xtb-add-pair"
                        >
                          Dodaj do par
                        </button>
                      </span>
                    ) : undefined),
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
                  doubt('direction'),
                  values.direction != null
                )}
                {row(
                  'entryTime',
                  'Czas wejścia (WAW)',
                  <WawInput iso={values.entryTime} onChange={(v) => set({ entryTime: v }, 'entryTime')} testId="xtb-entry-time" />,
                  warsawText(trade.entryTime),
                  doubt('entryTime'),
                  values.entryTime != null
                )}
                {row(
                  'entry',
                  'Cena wejścia',
                  <NumberField className="w-[110px]" value={values.entry} onChange={(v) => set({ entry: v }, 'entry')} decimals={decimals} data-testid="xtb-entry" />,
                  price(trade.prices.entry),
                  doubt('entry'),
                  values.entry != null
                )}
                {row(
                  'stopLoss',
                  'Stop loss',
                  <NumberField className="w-[110px]" value={values.stopLoss} onChange={(v) => set({ stopLoss: v }, 'stopLoss')} decimals={decimals} data-testid="xtb-sl" />,
                  price(trade.prices.stopLoss),
                  doubt('stopLoss'),
                  values.stopLoss != null
                )}
                {row(
                  'takeProfit',
                  'TP1 (Take Profit)',
                  <NumberField className="w-[110px]" value={values.takeProfit} onChange={(v) => set({ takeProfit: v }, 'takeProfit')} decimals={decimals} data-testid="xtb-tp" />,
                  price(trade.prices.takeProfit1),
                  doubt('takeProfit'),
                  values.takeProfit != null
                )}
                {row(
                  'lots',
                  'Loty (wolumen)',
                  <NumberField className="w-[110px]" value={values.lots} onChange={(v) => set({ lots: v }, 'lots')} data-testid="xtb-lots" />,
                  trade.lots == null ? '—' : trade.lots.toFixed(lotDecimals(trade.lots)),
                  doubt('lots'),
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
                  [trade.exits.length > 1 ? `zastąpi ${trade.exits.length} wyjścia` : null, doubt('exit')].filter(Boolean).join(' · ') || undefined,
                  values.exitPrice != null
                )}
                {row(
                  'result',
                  `Wynik netto (${currency})`,
                  <NumberField className="w-[110px]" value={values.result} onChange={(v) => set({ result: v }, 'result')} decimals={2} data-testid="xtb-result" />,
                  trade.pnlAmountOverride == null ? '—' : fmtMoney(trade.pnlAmountOverride, trade.amountCurrency ?? currency),
                  [riskInOther ? `kwota ryzyka jest w ${trade.amountCurrency ?? settings.risk.legacyAmountCurrency} – zostanie uznana za ${currency}` : null, doubt('result')]
                    .filter(Boolean)
                    .join(' · ') || undefined,
                  values.result != null
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-muted" data-testid="xtb-extra">
                <span>
                  Instrument: <span className="num text-fg">{match?.read ?? position.symbol ?? '—'}</span>
                  {position.description ? <span className="text-dim"> ({position.description})</span> : null}
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
              {mismatch && expected != null && (
                <div className="text-[11.5px] text-accent" data-testid="xtb-warning">
                  Wynik brutto ze screenu ({actualGross!.toFixed(2)} {currency}) nie zgadza się z cenami i wolumenem (≈ {expected.toFixed(2)} {currency}) –
                  sprawdź ceny, wolumen i walutę konta.
                </div>
              )}
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
