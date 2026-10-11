import { useCallback, useEffect, useMemo, useState } from 'react'
import { nyParts } from '@shared/scanner/time'
import { INTERVALS, type Interval } from '@shared/scanner/types'
import type { ScannerStatus, StreamState } from '@shared/scanner/api'
import type { ScannerInstrument } from '@shared/scanner/settings'
import { instrumentPreset } from '@shared/scanner/instruments'
import { defaultDetectorParams, type DetectorParams } from '@shared/scanner/detectors/params'
import { useJournal } from '../../store/journal'
import { useScanner } from '../../store/scanner'
import { navigate } from '../../store/ui'
import { api } from '../../lib/api'
import { Badge, Panel, Segmented, cx } from '../../components/ui'
import { CandleChart } from './CandleChart'
import { useAnalysis } from './analysis'
import { DEFAULT_LAYERS, LAYER_IDS, LAYER_LABELS, type LayerFlags, type LayerId } from './layers'

const NO_INSTRUMENTS: readonly ScannerInstrument[] = []
const DEFAULT_PARAMS: DetectorParams = defaultDetectorParams()
const SYMBOL_KEY = 'ictj.scanner.symbol'
const INTERVAL_KEY = 'ictj.scanner.interval'
const LAYERS_KEY = 'ictj.scanner.layers'

function readLayers(): LayerFlags {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '{}') as Partial<Record<string, unknown>>
    const out = { ...DEFAULT_LAYERS }
    for (const id of LAYER_IDS) if (typeof raw[id] === 'boolean') out[id] = raw[id]
    return out
  } catch {
    return { ...DEFAULT_LAYERS }
  }
}

export const STREAM_LABEL: Record<StreamState, string> = {
  off: 'wyłączony',
  'no-key': 'brak klucza API',
  connecting: 'łączenie…',
  live: 'połączony',
  reconnecting: 'ponowne łączenie',
  'auth-failed': 'klucz odrzucony',
  'symbol-limit': 'limit symboli'
}

const REASON_LABEL: Record<string, string> = { instrument: 'instrument', DXY: 'DXY', EURX: 'EURX', SMT: 'SMT', conversion: 'przeliczenie' }

export function fmtAge(ms: number | null): string {
  if (ms === null) return '—'
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} d`
}

function fmtGap(sec: number): string {
  if (sec <= 0) return '—'
  if (sec < 3600) return `${Math.round(sec / 60)} min`
  return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} h`
}

/** Short NY date: 27.09.26 */
function nyDate(sec: number | null): string {
  if (sec === null) return '—'
  const [y, m, d] = nyParts(sec).date.split('-')
  return `${d}.${m}.${y!.slice(2)}`
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

/** Status line: New York clock, market, stream, data delay, API usage, symbol budget, history download. */
export function ScannerStatusBar({ status }: { status: ScannerStatus | null }) {
  const now = useNow()
  const p = nyParts(Math.floor(now / 1000))
  const days = ['', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd']
  const st = status?.stream
  const delay = st?.lastLiveTickAt ? now - st.lastLiveTickAt : null
  const bf = status?.backfill
  const item = (label: string, value: React.ReactNode, testId?: string, title?: string) => (
    <span className="flex items-center gap-1.5 whitespace-nowrap" data-testid={testId} title={title}>
      <span className="text-dim">{label}</span>
      {value}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-panel px-3 py-1.5 text-[11.5px]" data-testid="scanner-status">
      {item('NY', <span className="num text-fg-strong">{`${days[p.weekday]} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(new Date(now).getUTCSeconds()).padStart(2, '0')}`}</span>)}
      {item('rynek', <span className={status?.marketOpen ? 'text-fg-strong' : 'text-muted'}>{status ? (status.marketOpen ? 'otwarty' : 'zamknięty – otwarcie nd 17:00 NY') : '—'}</span>, 'scanner-market')}
      {item(
        'strumień',
        <span className={cx(st?.state === 'live' ? 'text-fg-strong' : st?.state === 'auth-failed' || st?.state === 'symbol-limit' ? 'text-warn' : 'text-muted')}>
          {status ? (status.network ? STREAM_LABEL[st!.state] : 'wyłączony (tryb testowy)') : '—'}
        </span>,
        'scanner-stream',
        st?.message ?? undefined
      )}
      {item('ostatni tick', <span className="num">{fmtAge(delay)}</span>, 'scanner-delay')}
      {item(
        'API dziś',
        <span className="num">{status ? `${status.usage.calls}${status.dailyLimit ? ` / ${status.dailyLimit}` : ''}` : '—'}</span>,
        'scanner-usage',
        'Wywołania EODHD policzone na tym komputerze (zapytanie o świece = 5 wywołań). Limit dzienny odświeża się o północy GMT.'
      )}
      {item(
        'symbole',
        <span className={cx('num', status?.plan.over && 'text-warn')}>{status ? `${status.plan.symbols.length} / ${status.plan.limit}` : '—'}</span>,
        'scanner-budget',
        'Limit 50 symboli na klucz API EODHD – wspólny dla wszystkich komputerów pracujących jednocześnie.'
      )}
      {bf?.running &&
        item('historia', <span className="num">{`etap ${bf.stage}/${bf.stages} · ${bf.done}/${bf.total}${bf.symbol ? ` · ${bf.symbol}` : ''}`}</span>, 'scanner-backfill')}
      {!bf?.running && bf && Object.keys(bf.errors).length > 0 &&
        item('historia', <span className="text-warn">{`błędy: ${Object.keys(bf.errors).join(', ')}`}</span>, 'scanner-backfill', Object.values(bf.errors).join('\n'))}
      {status?.restError && item('EODHD', <span className="text-warn">{status.restError.message}</span>, 'scanner-rest-error')}
    </div>
  )
}

/** Scanner tab (phase 1): data status of every symbol and a detailed chart. */
export function ScannerPage() {
  const status = useScanner((s) => s.status)
  const prices = useScanner((s) => s.prices)
  const instruments = useJournal((s) => s.journal?.settings.scanner.instruments ?? NO_INSTRUMENTS)
  const params = useJournal((s) => s.journal?.settings.scanner.detectors ?? DEFAULT_PARAMS)
  const now = useNow(5000)
  const symbols = useMemo(() => status?.symbols ?? [], [status])
  const choices = useMemo(() => (symbols.length ? symbols.map((s) => s.symbol) : instruments.map((i) => i.symbol)), [symbols, instruments])
  const [symbol, setSymbol] = useState(() => readStored(SYMBOL_KEY, choices, choices[0] ?? 'EURUSD'))
  const [interval, setInterval] = useState<Interval>(() => readStored(INTERVAL_KEY, INTERVALS, 'H1'))
  useEffect(() => {
    try {
      localStorage.setItem(SYMBOL_KEY, symbol)
      localStorage.setItem(INTERVAL_KEY, interval)
    } catch {
      // Private mode etc.: just not remembered.
    }
  }, [symbol, interval])
  const row = symbols.find((x) => x.symbol === symbol)
  const dataVersion = `${status?.backfill.finishedAt ?? ''}|${row?.coverageFrom ?? ''}|${status?.backfill.stage ?? ''}`
  const inst = instruments.find((i) => i.symbol === symbol)
  const decimals = inst?.priceDecimals ?? instrumentPreset(symbol).priceDecimals
  const pipSize = inst?.pipSize ?? instrumentPreset(symbol).pipSize
  const [layers, setLayers] = useState<LayerFlags>(readLayers)
  const toggleLayer = useCallback((id: LayerId) => {
    setLayers((l) => {
      const next = { ...l, [id]: !l[id] }
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next))
      } catch {
        // Not remembered.
      }
      return next
    })
  }, [])
  const analysis = useAnalysis(symbol, pipSize, params, dataVersion)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="scanner-page">
      <ScannerStatusBar status={status} />
      {status && !status.key.present && status.network && (
        <div className="flex items-center gap-3 border-b border-line bg-accent-soft px-3 py-1.5 text-[12px]" data-testid="scanner-no-key">
          <span>Skaner potrzebuje klucza API EODHD.</span>
          <button className="text-accent underline-offset-2 hover:underline" onClick={() => navigate({ page: 'settings', tab: 'scanner' })}>
            Ustawienia → Skaner
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <Panel
          title="Dane"
          className="w-[440px] shrink-0"
          bodyClassName="min-h-0 overflow-auto"
          actions={
            <button className="text-[11px] text-muted hover:text-fg-strong" onClick={() => void api.scanner.refresh()} title="Połącz ponownie i uzupełnij luki">
              odśwież
            </button>
          }
        >
          <table className="w-full text-[11.5px]" data-testid="scanner-symbols">
            <thead>
              <tr className="text-left text-[10.5px] tracking-wide text-muted uppercase">
                <th className="px-2 py-1 font-normal">Symbol</th>
                <th className="px-1 py-1 text-right font-normal">Cena</th>
                <th className="px-1 py-1 text-right font-normal" title="Czas od ostatniego ticka ze strumienia">Tick</th>
                <th className="px-1 py-1 font-normal whitespace-nowrap" title="Dane sprawdzone od (data NY)">Od</th>
                <th className="px-1 py-1 text-right font-normal whitespace-nowrap" title="Brakujące dane w godzinach rynku z ostatnich 24 h">Luki 24h</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map((s) => {
                const price = prices[s.symbol]
                const dec = instruments.find((i) => i.symbol === s.symbol)?.priceDecimals ?? instrumentPreset(s.symbol).priceDecimals
                return (
                  <tr
                    key={s.symbol}
                    onClick={() => setSymbol(s.symbol)}
                    className={cx('cursor-default border-t border-line/60 hover:bg-hover', s.symbol === symbol && 'bg-accent-soft')}
                    data-testid={`scanner-row-${s.symbol}`}
                  >
                    <td className="max-w-[190px] truncate px-2 py-1" title={s.reasons.map((r) => REASON_LABEL[r] ?? r).join(' · ')}>
                      <span className="num text-fg-strong">{s.symbol}</span>
                      <span className="ml-1.5 text-[10px] text-dim">{s.reasons.map((r) => REASON_LABEL[r] ?? r).join(' · ')}</span>
                    </td>
                    <td className="num px-1 py-1 text-right">{price ? price.bid.toFixed(dec) : '—'}</td>
                    <td className={cx('num px-1 py-1 text-right', s.streaming ? 'text-fg' : 'text-dim')}>{fmtAge(s.lastTick ? now - s.lastTick : null)}</td>
                    <td className="num px-1 py-1 whitespace-nowrap text-muted">{s.rest ? nyDate(s.coverageFrom) : <span title="EODHD nie ma historii – strumień i import CSV z TradingView">CSV</span>}</td>
                    <td className={cx('num px-1 py-1 text-right', s.gapSeconds24h > 0 && status?.marketOpen ? 'text-warn' : 'text-muted')}>{fmtGap(s.gapSeconds24h)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!symbols.length && <p className="p-3 text-muted">Brak listy symboli – otwórz folder dziennika.</p>}
        </Panel>
        <Panel
          title={
            <span className="flex items-center gap-2">
              <span className="num text-fg-strong">{symbol}</span>
              {status && !status.marketOpen && <Badge>rynek zamknięty</Badge>}
            </span>
          }
          className="min-w-0 flex-1"
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
          actions={<Segmented size="sm" value={interval} onChange={setInterval} options={[...INTERVALS].reverse().map((i) => ({ value: i, label: i }))} aria-label="Interwał" />}
        >
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1" data-testid="scanner-layers">
            <span className="mr-1 text-[10.5px] tracking-wide text-dim uppercase">warstwy</span>
            {LAYER_IDS.map((id) => (
              <button key={id} type="button" className="chip" aria-pressed={layers[id]} onClick={() => toggleLayer(id)} data-testid={`scanner-layer-${id}`}>
                {LAYER_LABELS[id]}
              </button>
            ))}
            <span className="num ml-auto text-[10.5px] text-dim" title="Czas analizy ICT (M15, H1, H4, D) w tym oknie" data-testid="scanner-analysis">
              {analysis ? `analiza ${analysis.ms} ms` : 'analiza…'}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <CandleChart symbol={symbol} interval={interval} decimals={decimals} dataVersion={dataVersion} snapshot={analysis?.snapshot ?? null} layers={layers} params={params} />
          </div>
        </Panel>
      </div>
    </div>
  )
}
