import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fileUrl } from '@shared/api'
import { excursionsFromBars, tradeLevels, type BarExcursion } from '@shared/calc/excursions'
import { parseTradingViewCsv, type Bar } from '@shared/calc/ohlc'
import type { ExcursionInput, TvAnalysis } from '@shared/import/tvChart'
import type { PairConfig, ScreenRef, Trade } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { imageFilesFrom } from '../../lib/image'
import { measureTv, nextFrame, readTvScreen, screenBlob, type TvScreenRead } from '../../lib/tvOcr'
import { updateRecord, useJournal } from '../../store/journal'
import { toast } from '../../store/ui'
import { Modal } from '../../components/Modal'
import { IconImage, IconWarn } from '../../components/icons'
import { NumberField, Toggle, cx } from '../../components/ui'
import { PHASES } from '../screens/ScreensPanel'

/**
 * MAE / MFE from TradingView: the Long / Short Position tool on the screenshot taken after the trade ("po"), with the
 * chart's CSV export ("Export chart data") as the exact check. OCR offline; nothing is saved but the values.
 */

const EXIT_LABEL = { stop: 'SL', target: 'cel (TP)', end: 'prawa krawędź narzędzia' } as const

const pips = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('-', '−'))

function excursionInput(trade: Trade, pair: PairConfig | undefined, skipEntryCandle: boolean): (ExcursionInput & { decimals: number | null }) | null {
  const lv = tradeLevels(trade)
  if (lv.entry == null) return null
  return {
    direction: lv.direction,
    entry: lv.entry,
    stopLoss: lv.stopLoss,
    takeProfit: lv.takeProfit,
    exitPrice: lv.exitPrice,
    pipSize: pair?.pipSize ?? 0.0001,
    decimals: pair?.priceDecimals ?? null,
    skipEntryCandle
  }
}

/** The screen to read by default: the last one taken after the trade. */
const afterScreen = (trade: Trade): ScreenRef | null => trade.screens.filter((s) => s.phase === 'after').at(-1) ?? null

/** Button in the MAE / MFE section of the trade editor. */
export function TvExcursionsButton({ trade, disabled }: { trade: Trade; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="btn h-[20px] px-1.5 text-[11px]"
        disabled={disabled || trade.status === 'missed'}
        onClick={() => setOpen(true)}
        title="MAE / MFE ze screena TradingView „po” (narzędzie Long / Short Position) albo dokładnie z CSV wykresu"
        data-testid="tv-open"
      >
        <IconImage size={12} /> Z TradingView
      </button>
      {open && <TvExcursionsDialog trade={trade} onClose={() => setOpen(false)} />}
    </>
  )
}

type Source = { kind: 'screen'; screen: ScreenRef; url: string } | { kind: 'file'; blob: Blob; url: string; name: string }

function TvExcursionsDialog({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const pairs = useJournal((s) => s.journal?.settings.pairs)
  const pair = pairs?.find((p) => p.symbol === trade.pair)
  const decimals = pair?.priceDecimals ?? 5
  const [source, setSource] = useState<Source | null>(() => {
    const s = afterScreen(trade)
    return s ? { kind: 'screen', screen: s, url: fileUrl(s.path) } : null
  })
  const [read, setRead] = useState<TvScreenRead | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'reading' | 'measuring' | 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const [result, setResult] = useState<TvAnalysis | null>(null)
  const [skipEntry, setSkipEntry] = useState(false)
  const [csv, setCsv] = useState<{ name: string; bars: Bar[]; skipped: number } | null>(null)
  const [use, setUse] = useState<'screen' | 'csv'>('screen')
  const [mae, setMae] = useState<number | null>(null)
  const [mfe, setMfe] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const run = useRef(0)

  const input = excursionInput(trade, pair, skipEntry)
  const inputKey = JSON.stringify(input)
  const levels = tradeLevels(trade)

  useEffect(() => () => void (source?.kind === 'file' && URL.revokeObjectURL(source.url)), [source])

  // OCR of the axis once per picture.
  useEffect(() => {
    if (!source) return
    const token = ++run.current
    setRead(null)
    setResult(null)
    setStatus({ kind: 'reading' })
    void (async () => {
      try {
        const blob = source.kind === 'screen' ? await screenBlob(source.screen.path) : source.blob
        const r = await readTvScreen(blob)
        if (token === run.current) setRead(r)
      } catch (e) {
        if (token === run.current) setStatus({ kind: 'error', message: `Odczyt nie powiódł się: ${errorMessage(e)}` })
      }
    })()
  }, [source])

  // Measuring again for other options (skip the entry candle, changed prices) needs no OCR.
  useEffect(() => {
    if (!read) return
    const parsed = JSON.parse(inputKey) as ReturnType<typeof excursionInput>
    if (!parsed) {
      setResult(null)
      setStatus({ kind: 'done' })
      return
    }
    let alive = true
    setStatus({ kind: 'measuring' })
    void nextFrame().then(() => {
      if (!alive) return
      setResult(measureTv(read, parsed, trade.prices.takeProfit2))
      setStatus({ kind: 'done' })
    })
    return () => {
      alive = false
    }
  }, [read, inputKey, trade.prices.takeProfit2])

  const csvResult = useMemo<BarExcursion | { error: string } | null>(() => {
    const parsed = JSON.parse(inputKey) as ReturnType<typeof excursionInput>
    if (!csv || !parsed || parsed.entry == null) return null
    return excursionsFromBars(csv.bars, {
      ...parsed,
      entry: parsed.entry,
      entryTime: trade.entryTime,
      exitTime: levels.exitTime
    })
  }, [csv, inputKey, trade.entryTime, levels.exitTime])

  const screenOk = result?.ok ? result : null
  const csvOk = csvResult && !('error' in csvResult) ? csvResult : null
  const chosen = use === 'csv' && csvOk ? csvOk : screenOk
  useEffect(() => {
    if (!chosen) return
    setMae(chosen.maePips)
    setMfe(chosen.mfePips)
  }, [chosen?.maePips, chosen?.mfePips]) // eslint-disable-line react-hooks/exhaustive-deps

  const fromFile = useCallback((blob: Blob, name: string) => setSource({ kind: 'file', blob, url: URL.createObjectURL(blob), name }), [])

  // Ctrl+V while the dialog is open reads the picture (and does not add it to the trade's screens).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData)
      e.stopPropagation()
      if (!files.length) return
      e.preventDefault()
      fromFile(files[0]!, 'wklejony obraz')
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [fromFile])

  const loadCsv = async () => {
    try {
      const file = await api.pickTextFile({ name: 'CSV z TradingView', extensions: ['csv', 'txt'] })
      if (!file) return
      const { bars, skipped } = parseTradingViewCsv(file.text)
      setCsv({ name: file.name, bars, skipped })
      setUse('csv')
    } catch (e) {
      toast(errorMessage(e), 'error', 6000)
    }
  }

  const apply = () => {
    updateRecord('trades', trade.id, (t) => ({ ...t, maePips: mae, mfePips: mfe }))
    toast(`Wpisano MAE ${pips(mae)} / MFE ${pips(mfe)} pips (${use === 'csv' && csvOk ? 'z CSV' : 'ze screena'}).`, 'success')
    onClose()
  }

  const price = (v: number | null) => (v == null ? '—' : v.toFixed(decimals))
  const pxPips = screenOk ? Math.abs(screenOk.scale.b) / (pair?.pipSize ?? 0.0001) : null
  const screens = trade.screens
  const busy = status.kind === 'reading' || status.kind === 'measuring'
  const changed = mae !== trade.maePips || mfe !== trade.mfePips
  const diff = screenOk && csvOk ? { mae: Math.abs(screenOk.maePips - csvOk.maePips), mfe: Math.abs(screenOk.mfePips - csvOk.mfePips) } : null

  return (
    <Modal
      title="MAE / MFE z TradingView"
      onClose={onClose}
      width={1040}
      testId="tv-dialog"
      footer={
        <>
          <span className="flex-1 text-[11px] text-dim">Odczyt offline na tym komputerze. Zapisywane są tylko wartości MAE i MFE.</span>
          <button className="btn" onClick={onClose}>
            Anuluj
          </button>
          <button className="btn btn-accent" disabled={busy || (mae == null && mfe == null) || !changed} onClick={apply} data-testid="tv-apply">
            Wpisz MAE / MFE
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            className={cx('relative flex h-[440px] items-center justify-center border bg-bg', dragOver ? 'border-accent' : 'border-line')}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = imageFilesFrom(e.dataTransfer)[0]
              if (f) fromFile(f, f.name)
            }}
          >
            {source ? (
              <ToolPreview url={source.url} read={read} result={screenOk} />
            ) : (
              <div className="p-6 text-center text-[12px] leading-relaxed text-muted">
                Transakcja nie ma screena „po”.
                <br />
                Wklej screen z TradingView (Ctrl+V), upuść plik albo wybierz go poniżej.
              </div>
            )}
            {busy && (
              <div className="absolute left-2 top-2 border border-line bg-panel px-2 py-1 text-[11.5px] text-muted" data-testid="tv-busy">
                {status.kind === 'reading' ? 'Czytam oś ceny…' : 'Mierzę świece…'}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {screens.map((s) => {
              const active = source?.kind === 'screen' && source.screen.id === s.id
              return (
                <button
                  key={s.id}
                  className={cx('h-[46px] w-[74px] overflow-hidden border', active ? 'border-accent' : 'border-line hover:border-line-strong')}
                  onClick={() => setSource({ kind: 'screen', screen: s, url: fileUrl(s.path) })}
                  title={`${PHASES.find((p) => p.id === s.phase)?.label ?? 'Screen'}${s.timeframe ? ` · ${s.timeframe}` : ''}`}
                  data-testid="tv-screen"
                >
                  <img src={fileUrl(s.thumbPath)} alt="" className="h-full w-full object-cover object-right" />
                </button>
              )
            })}
            <button className="btn" onClick={() => fileInput.current?.click()} data-testid="tv-file">
              <IconImage size={13} /> Inny obraz…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0]
                if (f) fromFile(f, f.name)
                e.currentTarget.value = ''
              }}
            />
            <span className="text-[11px] text-dim">
              {source?.kind === 'file' ? `${source.name} (nie jest zapisywany)` : 'albo Ctrl+V – screen z narzędziem Long / Short Position, z osią ceny'}
            </span>
          </div>
        </div>

        <div className="flex w-[320px] shrink-0 flex-col gap-3 text-[12px]">
          {!input && <Note>Wpisz cenę wejścia – po niej jest rozpoznawane narzędzie i liczone MAE / MFE.</Note>}
          {input && input.stopLoss == null && <Note>Bez SL narzędzie jest dopasowane tylko po wejściu – wpisz SL dla pewności.</Note>}

          <section className="flex flex-col gap-1" data-testid="tv-screen-result">
            <h3 className="label">Ze screena</h3>
            {status.kind === 'error' && <div className="text-down">{status.message}</div>}
            {result && !result.ok && <div className="text-down" data-testid="tv-error">{result.error}</div>}
            {screenOk && (
              <>
                <Row label="MAE" value={<span className="num text-down" data-testid="tv-mae">{pips(screenOk.maePips)}</span>} />
                <Row label="MFE" value={<span className="num text-up" data-testid="tv-mfe">{pips(screenOk.mfePips)}</span>} />
                <Row label="Koniec pomiaru" value={EXIT_LABEL[screenOk.exit]} />
                <Row
                  label="Narzędzie"
                  value={
                    <span className="num">
                      {price(screenOk.tool.entry)} · SL {price(screenOk.tool.stop)} · cel {price(screenOk.tool.target)}
                    </span>
                  }
                />
                <Row
                  label="Oś ceny"
                  value={
                    <span className="num" title="Etykiety osi odczytane przez OCR i największe odchylenie od prostej">
                      {screenOk.scale.n} etykiet · ±{screenOk.scale.maxResidualPx.toFixed(1)} px · 1 px = {pxPips?.toFixed(2)} p
                    </span>
                  }
                />
                {screenOk.warnings.map((w) => (
                  <Note key={w}>{w}</Note>
                ))}
              </>
            )}
            <Toggle checked={skipEntry} onChange={setSkipEntry} label="Pomiń świecę wejścia" data-testid="tv-skip-entry" />
          </section>

          <section className="flex flex-col gap-1 border-t border-line pt-2" data-testid="tv-csv">
            <div className="flex items-center gap-2">
              <h3 className="label flex-1">Dokładnie z CSV</h3>
              <button className="btn h-[22px] px-1.5 text-[11px]" onClick={() => void loadCsv()} disabled={!input} data-testid="tv-csv-load">
                Wczytaj CSV…
              </button>
            </div>
            {!csv && (
              <div className="text-[11px] leading-relaxed text-dim">
                TradingView → menu wykresu → „Export chart data…” (najlepiej M1 z dniem transakcji). Liczone od świecy wejścia do świecy
                wyjścia wg czasów transakcji.
              </div>
            )}
            {csv && csvResult && 'error' in csvResult && <div className="text-down">{csvResult.error}</div>}
            {csvOk && (
              <>
                <Row label="MAE" value={<span className="num text-down" data-testid="tv-csv-mae">{pips(csvOk.maePips)}</span>} />
                <Row label="MFE" value={<span className="num text-up" data-testid="tv-csv-mfe">{pips(csvOk.mfePips)}</span>} />
                <Row label="Świece" value={<span className="num">{csvOk.bars} × {csvOk.barMinutes} min</span>} />
                {diff && (
                  <Row
                    label="Różnica"
                    value={
                      <span className={cx('num', Math.max(diff.mae, diff.mfe) > 2 * Math.max(1, pxPips ?? 1) && 'text-accent')}>
                        MAE {diff.mae.toFixed(1)} · MFE {diff.mfe.toFixed(1)} p
                      </span>
                    }
                  />
                )}
                {csvOk.warnings.map((w) => (
                  <Note key={w}>{w}</Note>
                ))}
              </>
            )}
            {csv && <div className="truncate text-[11px] text-dim">{csv.name}{csv.skipped ? ` · pominięto ${csv.skipped} wierszy` : ''}</div>}
          </section>

          <section className="flex flex-col gap-1.5 border-t border-line pt-2">
            <h3 className="label">Do transakcji</h3>
            {screenOk && csvOk && (
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={use === 'screen'} onChange={() => setUse('screen')} /> ze screena
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={use === 'csv'} onChange={() => setUse('csv')} data-testid="tv-use-csv" /> z CSV
                </label>
              </div>
            )}
            <div className="grid grid-cols-[40px_86px_1fr] items-center gap-x-2 gap-y-1">
              <span className="text-muted">MAE</span>
              <NumberField value={mae} onChange={setMae} decimals={1} step={0.1} typographicMinus aria-label="MAE do wpisania" data-testid="tv-mae-input" />
              <span className="num text-dim">teraz {pips(trade.maePips)}</span>
              <span className="text-muted">MFE</span>
              <NumberField value={mfe} onChange={setMfe} decimals={1} step={0.1} aria-label="MFE do wpisania" data-testid="tv-mfe-input" />
              <span className="num text-dim">teraz {pips(trade.mfePips)}</span>
            </div>
            <div className="text-[11px] text-dim">
              Transakcja: wejście {price(levels.entry)} · SL {price(levels.stopLoss)} · TP {price(levels.takeProfit)}
              {levels.exitPrice != null && ` · wyjście ${price(levels.exitPrice)}`}
            </div>
          </section>
        </div>
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[96px] shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-fg-strong">{value}</span>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-1.5 text-[11.5px] leading-snug text-accent">
      <IconWarn size={12} className="mt-[2px] shrink-0" />
      <span>{children}</span>
    </div>
  )
}

/** The screenshot around the tool with what was found: the tool, the entry, the measured columns and both extremes. */
function ToolPreview({ url, read, result }: { url: string; read: TvScreenRead | null; result: Extract<TvAnalysis, { ok: true }> | null }) {
  if (!read) return <img src={url} alt="" className="max-h-full max-w-full object-contain" />
  const { width, height } = read.image
  let view = { x: 0, y: 0, w: width, h: height }
  if (result) {
    const b = result.box
    const mx = Math.max(120, (b.right - b.left) * 0.8)
    const my = Math.max(60, (b.bottom - b.top) * 0.2)
    const x = Math.max(0, b.left - mx)
    const y = Math.max(0, b.top - my)
    view = { x, y, w: Math.min(width, b.right + mx) - x, h: Math.min(height, b.bottom + my) - y }
  }
  const sw = Math.max(1, view.w / 500)
  const r = result
  const point = (pt: { x: number; y: number } | null, color: string, text: string, testId: string) =>
    pt && r ? (
      <g data-testid={testId}>
        <line x1={r.range.x0} x2={r.range.x1} y1={pt.y} y2={pt.y} stroke={color} strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 3}`} />
        <circle cx={pt.x} cy={pt.y} r={sw * 4} fill="none" stroke={color} strokeWidth={sw * 1.5} />
        <text x={r.range.x1 + sw * 6} y={pt.y + sw * 4} fill={color} fontSize={sw * 12} fontFamily="JetBrains Mono, monospace">
          {text}
        </text>
      </g>
    ) : null
  return (
    <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" data-testid="tv-preview">
      <image href={url} x={0} y={0} width={width} height={height} />
      {r && (
        <>
          <rect x={r.box.left} y={r.box.top} width={r.box.right - r.box.left} height={r.box.bottom - r.box.top} fill="none" stroke="var(--color-accent)" strokeWidth={sw} />
          <line x1={r.box.left} x2={r.box.right} y1={r.splitY} y2={r.splitY} stroke="var(--color-accent)" strokeWidth={sw} />
          <rect x={r.range.x0} y={r.box.top} width={Math.max(1, r.range.x1 - r.range.x0)} height={r.box.bottom - r.box.top} fill="var(--color-accent)" opacity={0.08} />
          {point(r.points.mae, 'var(--color-down)', `MAE ${pips(r.maePips)}`, 'tv-mark-mae')}
          {point(r.points.mfe, 'var(--color-up)', `MFE ${pips(r.mfePips)}`, 'tv-mark-mfe')}
        </>
      )}
    </svg>
  )
}

/**
 * Filling empty MAE / MFE when a screen taken after the trade is added in the editor (setting on by default): read
 * in the background, written only if both are still empty, a toast says what was found.
 */
export function useAutoExcursions(trade: Trade | null, enabled: boolean): void {
  const pairs = useJournal((s) => s.journal?.settings.pairs)
  const known = useRef<Set<string> | null>(null)
  const key = trade?.screens
    .filter((s) => s.phase === 'after')
    .map((s) => s.id)
    .join(',')
  useEffect(() => {
    if (!trade) return
    const ids = key ? key.split(',') : []
    if (!known.current) {
      known.current = new Set(ids)
      return
    }
    const fresh = ids.filter((id) => !known.current!.has(id))
    for (const id of ids) known.current.add(id)
    if (!fresh.length || !enabled || trade.status === 'missed' || trade.maePips != null || trade.mfePips != null) return
    const screen = trade.screens.find((s) => s.id === fresh[fresh.length - 1])
    const input = excursionInput(trade, pairs?.find((p) => p.symbol === trade.pair), false)
    if (!screen || !input) return
    const id = trade.id
    const tp2 = trade.prices.takeProfit2
    void (async () => {
      try {
        const read = await readTvScreen(await screenBlob(screen.path))
        await nextFrame()
        const r = measureTv(read, input, tp2)
        if (!r.ok) {
          // A chart with a price axis but no tool found is worth a word; any other picture is not a chart.
          if (r.scale) toast(`MAE / MFE: ${r.error} Wpisz ręcznie albo użyj „Z TradingView”.`, 'info', 6000)
          return
        }
        let written = false
        updateRecord('trades', id, (t) => {
          if (t.maePips != null || t.mfePips != null) return t
          written = true
          return { ...t, maePips: r.maePips, mfePips: r.mfePips }
        })
        if (written)
          toast(
            `MAE ${pips(r.maePips)} / MFE ${pips(r.mfePips)} pips ze screena „po”${r.warnings.length ? ' – sprawdź w „Z TradingView” (są uwagi)' : ''}.`,
            r.warnings.length ? 'info' : 'success',
            6000
          )
      } catch {
        // Reading in the background: the editor stays as it was.
      }
    })()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

