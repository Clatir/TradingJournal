import { useEffect, useState, type ReactNode } from 'react'
import { newId } from '@shared/ids'
import { pipsBetween, directionSign, exitR } from '@shared/calc/trade'
import type { DictionaryKey, ScreenRef, Trade, TradeExit } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { fmtMoney, fmtPips, fmtR, fmtRatio, tone, toneClass } from '../../lib/format'
import { metricsFor } from '../../store/derived'
import { deleteRecord, discardDraft, updateRecord, useJournal } from '../../store/journal'
import { goBack, navigate, toast } from '../../store/ui'
import { DualTimeField, ExitClockField } from '../../components/TimeFields'
import { IconBack, IconExternal, IconFolder, IconPlus, IconTrash, IconClose } from '../../components/icons'
import { Badge, Chips, Empty, Field, NumberField, Panel, Segmented, TextArea, TextField, cx } from '../../components/ui'
import { ScreensPanel } from '../screens/ScreensPanel'

const MOOD_LABELS = ['', 'bardzo źle', 'słabo', 'neutralnie', 'dobrze', 'bardzo dobrze']

export function TradeEditor({ id }: { id: string }) {
  const entry = useJournal((s) => s.trades[id])
  const journal = useJournal((s) => s.journal)
  const folderReadOnly = useJournal((s) => s.status?.readOnly ?? false)
  const isDraft = useJournal((s) => !!s.drafts[id])
  const [activeExit, setActiveExit] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // An untouched new trade is never written to disk.
  useEffect(() => () => discardDraft('trades', id), [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        updateRecord('trades', id, (t) => ({ ...t, direction: 'long' }))
      } else if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        updateRecord('trades', id, (t) => ({ ...t, direction: 'short' }))
      } else if (e.key === 'Escape' && !typing && !e.defaultPrevented) {
        goBack()
      } else if (e.key === 'Escape' && typing) {
        ;(el as HTMLElement).blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])

  if (!entry || !journal) {
    return (
      <Empty>
        <div className="flex flex-col items-center gap-3">
          <span>Nie znaleziono transakcji (mogła zostać usunięta lub przeniesiona na innym komputerze).</span>
          <button className="btn" onClick={() => navigate({ page: 'journal' })}>
            Wróć do dziennika
          </button>
        </div>
      </Empty>
    )
  }

  const t = entry.record
  const settings = journal.settings
  const readOnly = entry.readOnly || folderReadOnly
  const m = metricsFor(t, settings)
  const pairCfg = settings.pairs.find((p) => p.symbol === t.pair)
  const decimals = pairCfg?.priceDecimals ?? 5
  const pip = pairCfg?.pipSize ?? 0.0001
  const currency = settings.risk.accountCurrency
  const showMoney = settings.display.showMoney
  const be = settings.stats.breakevenThresholdR

  const up = (fn: (t: Trade) => Trade) => updateRecord('trades', id, fn)
  const setField = <K extends keyof Trade>(k: K, v: Trade[K]) => up((r) => ({ ...r, [k]: v }))
  const setPrice = (k: keyof Trade['prices'], v: number | null) => up((r) => ({ ...r, prices: { ...r.prices, [k]: v } }))
  const setPsy = (patch: Partial<Trade['psychology']>) => up((r) => ({ ...r, psychology: { ...r.psychology, ...patch } }))
  const setExits = (fn: (x: TradeExit[]) => TradeExit[]) => up((r) => ({ ...r, exits: fn(r.exits) }))
  const setScreens = (fn: (s: ScreenRef[]) => ScreenRef[]) => up((r) => ({ ...r, screens: fn(r.screens) }))

  const dict = (key: DictionaryKey, keep: Array<string | null>) =>
    journal.dictionaries[key].filter((d) => !d.archived || keep.includes(d.id))

  const single = (key: DictionaryKey, field: 'entryModelId' | 'entryPdArrayId' | 'htfPdArrayId') => (
    <Chips items={dict(key, [t[field]])} selected={t[field] ? [t[field] as string] : []} onToggle={(v) => setField(field, t[field] === v ? null : v)} />
  )

  const quickExit = (price: number | null, note: string) => {
    if (price == null) {
      toast('Najpierw wpisz tę cenę.', 'info')
      return
    }
    setExits((xs) => {
      const list = xs.length ? [...xs] : [{ id: newId(), time: null, price: null, percent: 100, note: '' }]
      const idx = activeExit != null && activeExit < list.length ? activeExit : Math.max(0, list.findIndex((x) => x.price == null))
      const target = idx >= 0 ? idx : list.length - 1
      list[target] = { ...(list[target] as TradeExit), price, note: (list[target] as TradeExit).note || note }
      return list
    })
  }

  const addPartial = () =>
    setExits((xs) => {
      const used = xs.reduce((s, x) => s + x.percent, 0)
      const rest = Math.max(0, 100 - used)
      if (xs.length === 1 && rest === 0) {
        const half = Math.round((xs[0] as TradeExit).percent / 2)
        return [{ ...(xs[0] as TradeExit), percent: half }, { id: newId(), time: null, price: null, percent: 100 - half, note: '' }]
      }
      return [...xs, { id: newId(), time: null, price: null, percent: rest, note: '' }]
    })

  const doDelete = async () => {
    try {
      await deleteRecord('trades', id)
      toast('Transakcja przeniesiona do Kosza.', 'success')
      navigate({ page: 'journal' })
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const title = `${t.pair} ${t.direction === 'long' ? 'LONG' : 'SHORT'}`

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="trade-editor">
      <div className="flex h-[38px] shrink-0 items-center gap-3 border-b border-line bg-panel px-2">
        <button className="btn btn-ghost px-1.5" onClick={goBack} title="Wróć (Esc)">
          <IconBack />
        </button>
        <span className="num text-[14px] font-medium text-fg-strong">{title}</span>
        <span className="num text-muted">{m.tradingDate}</span>
        {m.killzoneNames.map((k) => (
          <Badge key={k} tone="accent">
            {k}
          </Badge>
        ))}
        {isDraft && <Badge title="Nowa transakcja zapisze się przy pierwszej zmianie">szkic</Badge>}
        {entry.readOnly && <Badge tone="warn">nowszy format – tylko odczyt</Badge>}
        <div className="ml-2">
          <Segmented
            aria-label="Status"
            size="sm"
            value={t.status}
            onChange={(v) => setField('status', v)}
            options={[
              { value: 'closed', label: 'Zamknięta' },
              { value: 'open', label: 'Otwarta' },
              { value: 'missed', label: 'Missed' }
            ]}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {t.tradingViewUrl && (
            <button className="btn" onClick={() => api.openExternal(t.tradingViewUrl).catch((e) => toast(errorMessage(e), 'error'))}>
              <IconExternal size={13} /> TradingView
            </button>
          )}
          {entry.relPath && (
            <button className="btn btn-ghost px-1.5" title="Pokaż plik w folderze" onClick={() => api.showInFolder(entry.relPath)}>
              <IconFolder />
            </button>
          )}
          {!readOnly &&
            (confirmDelete ? (
              <>
                <button className="btn border-down/60 text-down" onClick={doDelete} data-testid="confirm-delete">
                  Usuń na pewno
                </button>
                <button className="btn btn-ghost px-1.5" onClick={() => setConfirmDelete(false)}>
                  <IconClose />
                </button>
              </>
            ) : (
              <button className="btn btn-ghost px-1.5 hover:text-down" title="Usuń transakcję" onClick={() => setConfirmDelete(true)}>
                <IconTrash />
              </button>
            ))}
        </div>
      </div>

      <fieldset disabled={readOnly} className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1fr)_minmax(340px,1fr)_minmax(420px,1.2fr)]">
        {/* ------------------------------------------------ column 1 */}
        <div className="flex min-h-0 flex-col overflow-y-auto border-r border-line">
          <Section title="Podstawy">
            <Field label="Para">
              <Chips
                items={settings.pairs.filter((p) => !p.archived || p.symbol === t.pair).map((p) => ({ id: p.symbol, name: p.symbol }))}
                selected={[t.pair]}
                onToggle={(v) => setField('pair', v)}
              />
            </Field>
            <Field label="Kierunek" hint={<span className="text-dim">Alt+L / Alt+S</span>}>
              <Segmented
                aria-label="Kierunek"
                value={t.direction}
                onChange={(v) => setField('direction', v)}
                options={[
                  { value: 'long', label: 'Long' },
                  { value: 'short', label: 'Short' }
                ]}
              />
            </Field>
            <Field label="Wejście">
              <DualTimeField iso={t.entryTime} onChange={(v) => setField('entryTime', v)} primary={settings.display.timeInputZone} testId="entry-time" />
            </Field>
            <Field label="Killzone">
              <div className="flex items-center gap-2">
                <select
                  className="input w-[150px]"
                  value={t.killzoneOverride ?? ''}
                  onChange={(e) => setField('killzoneOverride', e.currentTarget.value || null)}
                  aria-label="Killzone"
                >
                  <option value="">auto</option>
                  {settings.killzones
                    .filter((k) => !k.archived)
                    .map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} ({k.start}–{k.end})
                      </option>
                    ))}
                  <option value="none">poza killzone</option>
                </select>
                <span className={cx('text-[11.5px]', m.killzoneNames.length ? 'text-accent' : 'text-muted')} data-testid="killzone-detected">
                  {m.killzoneNames.length ? m.killzoneNames.join(' + ') : 'poza killzone'}
                </span>
              </div>
            </Field>
          </Section>

          <Section title="Ceny">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <PriceField label="Wejście" value={t.prices.entry} onChange={(v) => setPrice('entry', v)} decimals={decimals} step={pip} testId="price-entry" autoFocus={isDraft} />
              <PriceField label="Stop loss" value={t.prices.stopLoss} onChange={(v) => setPrice('stopLoss', v)} decimals={decimals} step={pip} testId="price-sl" />
              <PriceField label="TP1" value={t.prices.takeProfit1} onChange={(v) => setPrice('takeProfit1', v)} decimals={decimals} step={pip} testId="price-tp1" />
              <PriceField label="TP2" value={t.prices.takeProfit2} onChange={(v) => setPrice('takeProfit2', v)} decimals={decimals} step={pip} testId="price-tp2" />
            </div>
            <div className="mt-2 grid grid-cols-3 border border-line">
              <Metric label="SL" value={m.riskPips != null ? `${m.riskPips.toFixed(1)} p` : '—'} testId="metric-sl" />
              <Metric label="R:R TP1" value={fmtRatio(m.rrTp1)} testId="metric-rr1" />
              <Metric label="R:R TP2" value={fmtRatio(m.rrTp2)} />
            </div>
          </Section>

          {t.status !== 'missed' ? (
            <Section
              title="Wyjście i partiale"
              actions={
                <div className="flex gap-1">
                  {(
                    [
                      ['TP1', t.prices.takeProfit1],
                      ['TP2', t.prices.takeProfit2],
                      ['SL', t.prices.stopLoss],
                      ['BE', t.prices.entry]
                    ] as const
                  ).map(([label, price]) => (
                    <button key={label} className="btn h-[20px] px-1.5 text-[11px]" onClick={() => quickExit(price, label)} data-testid={`quick-${label}`}>
                      {label}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="grid grid-cols-[52px_minmax(84px,1fr)_58px_minmax(0,1fr)_60px_20px] items-center gap-1 text-[10.5px] text-muted">
                <span>%</span>
                <span>Cena</span>
                <span>Czas NY</span>
                <span>Notatka</span>
                <span className="text-right">R</span>
                <span />
              </div>
              {t.exits.map((x, i) => {
                const r = t.prices.entry != null && t.prices.stopLoss != null && x.price != null ? exitR(t.direction, t.prices.entry, t.prices.stopLoss, x.price) : null
                const pips = t.prices.entry != null && x.price != null ? directionSign(t.direction) * pipsBetween(t.prices.entry, x.price, pip) : null
                const setX = (patch: Partial<TradeExit>) => setExits((xs) => xs.map((e, j) => (j === i ? { ...e, ...patch } : e)))
                return (
                  <div
                    key={x.id}
                    className={cx('mt-1 grid grid-cols-[52px_minmax(84px,1fr)_58px_minmax(0,1fr)_60px_20px] items-center gap-1', activeExit === i && 'outline outline-1 outline-line-strong')}
                    onFocusCapture={() => setActiveExit(i)}
                  >
                    <NumberField value={x.percent} onChange={(v) => setX({ percent: Math.max(0, Math.min(100, v ?? 0)) })} decimals={0} step={5} aria-label="Procent pozycji" />
                    <NumberField value={x.price} onChange={(v) => setX({ price: v })} decimals={decimals} step={pip} aria-label="Cena wyjścia" data-testid={`exit-price-${i}`} />
                    <ExitClockField iso={x.time} referenceIso={t.entryTime} onChange={(v) => setX({ time: v })} />
                    <input className="input text-[11.5px]" value={x.note} placeholder="np. TP1" onChange={(e) => setX({ note: e.currentTarget.value })} />
                    <span className={cx('num text-right', toneClass[tone(r, be)])} title={pips != null ? `${fmtPips(pips)} pips` : ''}>
                      {fmtR(r)}
                    </span>
                    <button
                      className="text-dim hover:text-down"
                      title="Usuń wiersz"
                      onClick={() => setExits((xs) => xs.filter((_, j) => j !== i))}
                      aria-label="Usuń wyjście"
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                )
              })}
              <div className="mt-1.5 flex items-center gap-2">
                <button className="btn h-[22px] text-[11.5px]" onClick={addPartial}>
                  <IconPlus size={12} /> partial
                </button>
                {m.percentMismatch && <span className="text-[11px] text-accent">Partiale sumują się do {m.closedPercent.toFixed(0)}% – wynik liczony proporcjonalnie.</span>}
              </div>
              <ResultStrip
                r={m.resultR}
                pips={m.resultPips}
                money={showMoney ? fmtMoney(m.pnlAmount, currency) : null}
                be={be}
                note={t.status === 'open' ? 'zrealizowane dotąd' : m.outcome === 'breakeven' ? 'break-even' : null}
              />
            </Section>
          ) : (
            <Section title="Missed trade – co by było">
              <Field label="Powód">
                <Chips
                  items={dict('missedReasons', [t.missed.reasonId])}
                  selected={t.missed.reasonId ? [t.missed.reasonId] : []}
                  onToggle={(v) => up((r) => ({ ...r, missed: { ...r.missed, reasonId: r.missed.reasonId === v ? null : v } }))}
                />
              </Field>
              <Field label="Cena doszła do" className="mt-1.5">
                <Segmented
                  value={t.missed.hypotheticalOutcome}
                  onChange={(v) => up((r) => ({ ...r, missed: { ...r.missed, hypotheticalOutcome: v } }))}
                  options={[
                    { value: 'tp1', label: 'TP1' },
                    { value: 'tp2', label: 'TP2' },
                    { value: 'sl', label: 'SL' },
                    { value: 'none', label: 'nic' }
                  ]}
                />
              </Field>
              <ResultStrip r={m.resultR} pips={m.resultPips} money={null} be={be} note="hipotetycznie – poza statystykami" />
            </Section>
          )}

          <Section title="MAE / MFE">
            <div className="grid grid-cols-2 gap-x-3">
              <Field label="MAE (pips)">
                <div className="flex items-center gap-2">
                  <NumberField value={t.maePips} onChange={(v) => setField('maePips', v)} decimals={1} step={0.1} />
                  <span className="num w-[52px] text-right text-muted">{m.maeR != null ? `${m.maeR.toFixed(2)}R` : ''}</span>
                </div>
              </Field>
              <Field label="MFE (pips)">
                <div className="flex items-center gap-2">
                  <NumberField value={t.mfePips} onChange={(v) => setField('mfePips', v)} decimals={1} step={0.1} />
                  <span className="num w-[52px] text-right text-muted">{m.mfeR != null ? `${m.mfeR.toFixed(2)}R` : ''}</span>
                </div>
              </Field>
            </div>
          </Section>

          <Section title="Ryzyko">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Field label="Ryzyko %">
                <NumberField value={t.riskPercent} onChange={(v) => setField('riskPercent', v)} decimals={2} step={0.05} />
              </Field>
              <Field label="Loty">
                <NumberField value={t.lots} onChange={(v) => setField('lots', v)} decimals={2} step={0.01} />
              </Field>
              {showMoney && (
                <>
                  <Field label={`Ryzyko ${currency}`}>
                    <NumberField value={t.riskAmount} onChange={(v) => setField('riskAmount', v)} decimals={2} />
                  </Field>
                  <Field label={`Wynik ${currency}`} hint="puste = R × ryzyko">
                    <NumberField value={t.pnlAmountOverride} onChange={(v) => setField('pnlAmountOverride', v)} decimals={2} placeholder="auto" />
                  </Field>
                </>
              )}
            </div>
          </Section>
        </div>

        {/* ------------------------------------------------ column 2 */}
        <div className="flex min-h-0 flex-col overflow-y-auto border-r border-line">
          <Section title="Kontekst ICT">
            <div className="flex flex-col gap-2">
              <Field label="Model wejścia">{single('entryModels', 'entryModelId')}</Field>
              <Field label="PD array wejścia">{single('pdArrays', 'entryPdArrayId')}</Field>
              <Field label="PD array HTF">{single('pdArrays', 'htfPdArrayId')}</Field>
              <Field label="Zebrana płynność">
                <Chips
                  items={dict('liquidityPools', t.liquidityTakenIds)}
                  selected={t.liquidityTakenIds}
                  onToggle={(v) =>
                    setField('liquidityTakenIds', t.liquidityTakenIds.includes(v) ? t.liquidityTakenIds.filter((x) => x !== v) : [...t.liquidityTakenIds, v])
                  }
                />
              </Field>
              <Field label="SL poza płynnością">
                <Segmented
                  size="sm"
                  value={t.stopBeyondLiquidity}
                  onChange={(v) => setField('stopBeyondLiquidity', v)}
                  options={[
                    { value: 'yes', label: 'Tak' },
                    { value: 'no', label: 'Nie' },
                    { value: 'unknown', label: 'Nie oceniono' }
                  ]}
                />
              </Field>
              <Field label="TradingView">
                <TextField value={t.tradingViewUrl} onChange={(v) => setField('tradingViewUrl', v.trim())} placeholder="https://www.tradingview.com/x/…" />
              </Field>
            </div>
          </Section>

          <Section title="Psychologia">
            <div className="flex flex-col gap-1.5">
              {(
                [
                  ['before', 'Przed'],
                  ['during', 'W trakcie'],
                  ['after', 'Po']
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <div className="flex items-center gap-1.5">
                    <div className="inline-flex border border-line-strong" role="radiogroup" aria-label={`Stan ${label}`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          title={MOOD_LABELS[n]}
                          aria-checked={t.psychology[k].score === n}
                          role="radio"
                          onClick={() => setPsy({ [k]: { ...t.psychology[k], score: t.psychology[k].score === n ? null : n } })}
                          className={cx(
                            'num h-[24px] w-[22px] text-[11.5px]',
                            n > 1 && 'border-l border-line-strong',
                            t.psychology[k].score === n ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover'
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <input
                      className="input"
                      value={t.psychology[k].note}
                      placeholder="krótko: jak się czułem"
                      onChange={(e) => setPsy({ [k]: { ...t.psychology[k], note: e.currentTarget.value } })}
                    />
                  </div>
                </Field>
              ))}
              <Field label="Tagi błędów">
                <Chips
                  items={dict('mistakeTags', t.psychology.mistakeTagIds)}
                  selected={t.psychology.mistakeTagIds}
                  onToggle={(v) =>
                    setPsy({
                      mistakeTagIds: t.psychology.mistakeTagIds.includes(v)
                        ? t.psychology.mistakeTagIds.filter((x) => x !== v)
                        : [...t.psychology.mistakeTagIds, v]
                    })
                  }
                />
              </Field>
              <div className="mt-1 flex flex-col gap-1">
                <span className="text-[11.5px] text-muted">Co zrobiłem dobrze</span>
                <TextArea value={t.psychology.didWell} onChange={(v) => setPsy({ didWell: v })} rows={2} placeholder="np. czekałem na MSS zamiast wchodzić na dotyku FVG" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted">Co robię następnym razem</span>
                <TextArea value={t.psychology.nextTime} onChange={(v) => setPsy({ nextTime: v })} rows={2} placeholder="jedna konkretna rzecz do powtórzenia lub zmiany" />
              </div>
            </div>
          </Section>

          <Section title="Notatki" className="flex-1">
            <TextArea value={t.notes} onChange={(v) => setField('notes', v)} rows={4} placeholder="Narracja: co widziałem, co zrobiła cena" data-testid="trade-notes" />
          </Section>
        </div>

        {/* ------------------------------------------------ column 3 */}
        <div className="flex min-h-0 flex-col overflow-y-auto">
          <Section title={`Screeny (${t.screens.length})`}>
            <ScreensPanel screens={t.screens} onChange={setScreens} date={m.tradingDate} capturePaste={!readOnly} readOnly={readOnly} />
          </Section>
        </div>
      </fieldset>
    </div>
  )
}

function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Panel title={title} actions={actions} className={cx('border-0 border-b', className)}>
      {children}
    </Panel>
  )
}

function PriceField({
  label,
  value,
  onChange,
  decimals,
  step,
  testId,
  autoFocus
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  decimals: number
  step: number
  testId?: string
  autoFocus?: boolean
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <NumberField value={value} onChange={onChange} decimals={decimals} step={step} data-testid={testId} aria-label={label} autoFocus={autoFocus} />
    </label>
  )
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-r border-line px-2 py-1 last:border-r-0">
      <span className="label">{label}</span>
      <span className="num text-[13px] text-fg-strong" data-testid={testId}>
        {value}
      </span>
    </div>
  )
}

function ResultStrip({ r, pips, money, be, note }: { r: number | null; pips: number | null; money: string | null; be: number; note: string | null }) {
  const cls = toneClass[tone(r, be)]
  return (
    <div className="mt-2 flex items-baseline gap-4 border-t border-line pt-2">
      <span className="label">Wynik</span>
      <span className={cx('num text-[18px] font-medium', cls)} data-testid="result-r">
        {fmtR(r)}
      </span>
      <span className={cx('num text-[13px]', cls)}>{pips != null ? `${fmtPips(pips)} pips` : ''}</span>
      {money && <span className={cx('num text-[13px]', cls)}>{money}</span>}
      {note && <span className="ml-auto text-[11px] text-muted">{note}</span>}
    </div>
  )
}
