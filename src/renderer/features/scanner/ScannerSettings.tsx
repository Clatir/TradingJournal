import { useEffect, useState } from 'react'
import type { Settings } from '@shared/schema'
import { defaultInstrument, type ScannerInstrument, type ScannerSettings as ScannerSettingsT } from '@shared/scanner/settings'
import type { ExchangeSymbol } from '@shared/scanner/eodhd'
import type { SymbolUsage } from '@shared/scanner/api'
import { nyParts } from '@shared/scanner/time'
import { updateJournal } from '../../store/journal'
import { refreshScannerStatus, useScanner } from '../../store/scanner'
import { toast } from '../../store/ui'
import { api } from '../../lib/api'
import { Badge, NameInput, NumberField, Panel, Segmented, TextField, Toggle, cx } from '../../components/ui'
import { IconPlus, IconTrash } from '../../components/icons'

const setScanner = (fn: (s: ScannerSettingsT) => ScannerSettingsT) =>
  updateJournal((j) => ({ ...j, settings: { ...j.settings, scanner: fn(j.settings.scanner) } }))
const setInstrument = (symbol: string, patch: Partial<ScannerInstrument>) =>
  setScanner((s) => ({ ...s, instruments: s.instruments.map((i) => (i.symbol === symbol ? { ...i, ...patch } : i)) }))

const COLS = 'grid-cols-[84px_minmax(70px,1fr)_64px_86px_52px_86px_80px_minmax(110px,1fr)_70px]'
const REASON: Record<string, string> = { instrument: 'instrument', DXY: 'DXY', EURX: 'EURX', SMT: 'SMT', conversion: 'przeliczenie na walutę konta' }

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function KeyPanel() {
  const key = useScanner((s) => s.status?.key ?? null)
  const network = useScanner((s) => s.status?.network ?? true)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    try {
      const state = await api.scanner.setApiKey(draft)
      setDraft('')
      toast(state.persisted ? 'Klucz API zapisany (zaszyfrowany na tym komputerze).' : 'Klucz API zapamiętany do zamknięcia aplikacji (szyfrowanie niedostępne).', 'success')
      await refreshScannerStatus()
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), 'error')
    }
  }
  const test = async () => {
    setBusy(true)
    const r = await api.scanner.testApiKey()
    setBusy(false)
    if (!r.ok || !r.user) return toast(r.message ?? 'Nie udało się sprawdzić klucza.', 'error')
    const u = r.user
    const ws = u.feeds.some((f) => /websocket/i.test(f))
    const intraday = u.feeds.some((f) => /intraday/i.test(f))
    toast(
      `Klucz działa: plan ${u.subscriptionMode ?? '?'}, limit ${u.dailyRateLimit ?? '?'} wywołań dziennie, WebSocket ${ws ? 'tak' : 'NIE'}, historia intraday ${intraday ? 'tak' : 'NIE'}.`,
      ws && intraday ? 'success' : 'error'
    )
  }
  const clear = async () => {
    await api.scanner.clearApiKey()
    toast('Klucz API usunięty z tego komputera.', 'info')
    await refreshScannerStatus()
  }
  return (
    <Panel title="Klucz API EODHD">
      <div className="flex flex-wrap items-center gap-2" data-testid="scanner-key">
        <input
          className="input num w-[300px]"
          type="password"
          value={draft}
          placeholder={key?.present ? `zapisany: ${key.masked}` : 'wklej klucz z panelu EODHD'}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && draft.trim() && void save()}
          aria-label="Klucz API EODHD"
          data-testid="scanner-key-input"
        />
        <button className="btn" disabled={!draft.trim()} onClick={() => void save()}>
          Zapisz
        </button>
        <button className="btn" disabled={!key?.present || busy || !network} onClick={() => void test()} data-testid="scanner-key-test">
          {busy ? 'Sprawdzam…' : 'Sprawdź'}
        </button>
        <button className="btn" disabled={!key?.present || key.source === 'env'} onClick={() => void clear()}>
          Usuń
        </button>
        {key?.present && <Badge tone={key.persisted ? 'default' : 'warn'}>{key.source === 'env' ? 'ze zmiennej środowiskowej' : key.persisted ? 'zaszyfrowany' : 'tylko do zamknięcia'}</Badge>}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        Klucz jest szyfrowany przez Windows (DPAPI) i zapisany tylko na tym komputerze – nie trafia do folderu dziennika ani do logów. Na każdym
        komputerze trzeba go wpisać osobno.
      </p>
    </Panel>
  )
}

function InstrumentsPanel({ s }: { s: ScannerSettingsT }) {
  const [list, setList] = useState<ExchangeSymbol[]>([])
  const [add, setAdd] = useState('')
  useEffect(() => {
    api.scanner.symbols().then(setList, () => undefined)
  }, [])
  const addSymbol = () => {
    const code = add.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!/^[A-Z0-9]{3,15}$/.test(code)) return toast('Wpisz symbol z listy EODHD, np. GBPUSD.', 'error')
    if (s.instruments.some((i) => i.symbol === code)) return toast(`${code} już jest na liście.`, 'error')
    if (list.length && !list.some((x) => x.code === code) && code !== 'WTIUSD') toast(`${code} nie ma na liście FOREX EODHD – sprawdź, czy będzie streamować.`, 'info')
    setScanner((x) => ({ ...x, instruments: [...x.instruments, defaultInstrument(code)] }))
    setAdd('')
  }
  const importCsv = async (symbol: string) => {
    try {
      const r = await api.scanner.importCsv(symbol)
      if (!r) return
      const d = (t: number) => nyParts(t).date
      toast(`${symbol}: zaimportowano ${r.count} świec ${r.interval} (${d(r.from)} – ${d(r.to - 1)})${r.weekend ? `, pominięto ${r.weekend} z weekendu` : ''}.`, 'success')
      await refreshScannerStatus()
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), 'error')
    }
  }
  return (
    <Panel title="Instrumenty skanera">
      <div className="overflow-x-auto" data-testid="scanner-instruments">
        <div className="min-w-[860px]">
          <div className={cx('grid items-center gap-2 border-b border-line/70 py-1 text-[10.5px] tracking-wide text-muted uppercase', COLS)}>
            <span>Symbol</span>
            <span>Nazwa</span>
            <span>Aktywny</span>
            <span>Pips</span>
            <span>Miejsca</span>
            <span>Jedn. / lot</span>
            <span title="Maksymalny SL w pipsach; puste = wartość ogólna dla FX">Maks. SL p</span>
            <span title="Kod historii REST EODHD; puste = brak historii (strumień + import CSV)">Historia EODHD</span>
            <span />
          </div>
          {s.instruments.map((i) => (
            <div key={i.symbol} className={cx('grid items-center gap-2 border-b border-line/70 py-1', COLS, !i.enabled && 'opacity-50')} data-testid={`scanner-inst-${i.symbol}`}>
              <span className="num text-fg-strong">{i.symbol}</span>
              <NameInput value={i.label || i.symbol} maxLength={20} onChange={(v) => setInstrument(i.symbol, { label: v })} aria-label="Nazwa" />
              <Toggle checked={i.enabled} onChange={(v) => setInstrument(i.symbol, { enabled: v })} label="" />
              <NumberField value={i.pipSize} onChange={(v) => v && v > 0 && setInstrument(i.symbol, { pipSize: v })} isValid={(v) => v !== null && v > 0} aria-label="Wielkość pipsa" />
              <NumberField
                value={i.priceDecimals}
                onChange={(v) => v !== null && setInstrument(i.symbol, { priceDecimals: Math.round(v) })}
                isValid={(v) => v !== null && v >= 0 && v <= 8 && Number.isInteger(v)}
                aria-label="Miejsca po przecinku"
              />
              <NumberField value={i.contractSize} onChange={(v) => v && v > 0 && setInstrument(i.symbol, { contractSize: v })} isValid={(v) => v !== null && v > 0} aria-label="Jednostek w locie" />
              <NumberField
                value={i.maxStopPips}
                placeholder={i.contractSize === 100000 ? String(s.maxStopPips) : 'auto'}
                onChange={(v) => setInstrument(i.symbol, { maxStopPips: v && v > 0 ? v : null })}
                isValid={(v) => v === null || v > 0}
                aria-label="Maksymalny SL w pipsach"
              />
              <TextField value={i.rest ?? ''} mono placeholder="brak – tylko CSV" onChange={(v) => setInstrument(i.symbol, { rest: v.trim() || null })} aria-label="Kod REST EODHD" />
              <span className="flex items-center justify-end gap-1">
                <button className="btn h-[22px] px-1.5 text-[11px]" onClick={() => void importCsv(i.symbol)} title="Import świec z TradingView (Export chart data, 1 min albo 1 h)" data-testid={`scanner-import-${i.symbol}`}>
                  CSV
                </button>
                <button
                  className="text-muted hover:text-fg-strong"
                  title="Usuń z listy"
                  onClick={() => setScanner((x) => ({ ...x, instruments: x.instruments.filter((y) => y.symbol !== i.symbol) }))}
                >
                  <IconTrash size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          className="input num w-[160px]"
          list="scanner-eodhd-symbols"
          value={add}
          placeholder="np. GBPUSD"
          onChange={(e) => setAdd(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
          aria-label="Symbol do dodania"
          data-testid="scanner-add-symbol"
        />
        <datalist id="scanner-eodhd-symbols">
          {list.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name}
            </option>
          ))}
        </datalist>
        <button className="btn" onClick={addSymbol}>
          <IconPlus size={13} /> Dodaj
        </button>
        <span className="text-[11.5px] text-muted">{list.length ? `${list.length} symboli na liście FOREX EODHD` : 'lista EODHD pojawi się po zapisaniu klucza'}</span>
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        Złoto: pips 0,1 USD, maks. SL 650 p = 65 USD. WTI (WTIUSD) ma w EODHD tylko ceny na żywo – historię wczytaj przyciskiem CSV z TradingView
        (Export chart data, interwał 1 godzina).
      </p>
    </Panel>
  )
}

function DataPanel({ s }: { s: ScannerSettingsT }) {
  return (
    <Panel title="Dane i świece">
      <div className="grid grid-cols-[220px_1fr] items-center gap-x-4 gap-y-2" data-testid="scanner-options">
        <span>Cena świec ze strumienia</span>
        <span>
          <Segmented
          value={s.price}
          onChange={(v) => setScanner((x) => ({ ...x, price: v }))}
          options={[
            { value: 'bid', label: 'bid', title: 'Jak historia EODHD i TradingView (OANDA)' },
            { value: 'mid', label: 'mid', title: 'Średnia bid i ask' }
          ]}
          />
        </span>
        <span>Historia instrumentów (dni)</span>
        <NumberField value={s.depthDays} onChange={(v) => v && setScanner((x) => ({ ...x, depthDays: Math.round(Math.min(1500, Math.max(14, v))) }))} className="w-[90px]" aria-label="Historia instrumentów" />
        <span>Historia pozostałych symboli (dni)</span>
        <NumberField
          value={s.componentDepthDays}
          onChange={(v) => v && setScanner((x) => ({ ...x, componentDepthDays: Math.round(Math.min(1500, Math.max(14, v))) }))}
          className="w-[90px]"
          aria-label="Historia składników"
        />
        <span>Maks. SL dla par walutowych (pipsy)</span>
        <NumberField value={s.maxStopPips} onChange={(v) => v && v > 0 && setScanner((x) => ({ ...x, maxStopPips: v }))} className="w-[90px]" aria-label="Maksymalny SL" />
        <span>Indeksy syntetyczne</span>
        <span className="flex gap-4">
          <Toggle checked={s.synthetic.DXY} onChange={(v) => setScanner((x) => ({ ...x, synthetic: { ...x.synthetic, DXY: v } }))} label="DXY" />
          <Toggle checked={s.synthetic.EURX} onChange={(v) => setScanner((x) => ({ ...x, synthetic: { ...x.synthetic, EURX: v } }))} label="EURX" />
        </span>
      </div>
    </Panel>
  )
}

function BudgetPanel() {
  const plan = useScanner((s) => s.status?.plan ?? null)
  if (!plan) return null
  return (
    <Panel title={`Subskrypcja: ${plan.symbols.length} z ${plan.limit} symboli`}>
      <div className="flex flex-wrap gap-1.5" data-testid="scanner-plan">
        {plan.symbols.map((sym) => (
          <span key={sym} className="border border-line px-1.5 py-0.5 text-[11px]" title={(plan.reasons[sym] ?? []).map((r) => REASON[r] ?? r).join(', ')}>
            <span className="num">{sym}</span>
          </span>
        ))}
      </div>
      <p className={cx('mt-2 text-[11.5px]', plan.over ? 'text-warn' : 'text-muted')}>
        {plan.over
          ? 'Za dużo symboli – EODHD odrzuci subskrypcję. Wyłącz instrument albo indeks syntetyczny.'
          : 'Limit 50 symboli jest wspólny dla klucza API – dwa komputery pracujące jednocześnie liczą się razem.'}
      </p>
    </Panel>
  )
}

function CachePanel() {
  const [usage, setUsage] = useState<SymbolUsage[] | null>(null)
  const load = () => api.scanner.cacheUsage().then(setUsage, () => setUsage([]))
  useEffect(() => {
    void load()
  }, [])
  const total = (usage ?? []).reduce((s, u) => s + u.bytes, 0)
  const clear = async (symbol?: string) => {
    await api.scanner.clearCache(symbol)
    toast(symbol ? `Dane ${symbol} usunięte – zostaną pobrane ponownie.` : 'Cache świec wyczyszczony – dane zostaną pobrane ponownie.', 'info')
    void load()
  }
  return (
    <Panel
      title={`Cache świec na tym komputerze: ${mb(total)}`}
      actions={
        <button className="text-[11px] text-muted hover:text-fg-strong" onClick={() => void clear()} data-testid="scanner-cache-clear">
          wyczyść wszystko
        </button>
      }
    >
      <div className="grid grid-cols-[90px_80px_1fr_40px] gap-x-3 gap-y-0.5 text-[11.5px]" data-testid="scanner-cache">
        {(usage ?? []).map((u) => (
          <div key={u.symbol} className="contents">
            <span className="num text-fg-strong">{u.symbol}</span>
            <span className="num text-right">{mb(u.bytes)}</span>
            <span className="num text-muted">{u.from !== null && u.to !== null ? `${nyParts(u.from).date} – ${nyParts(u.to - 1).date}` : '—'}</span>
            <button className="text-muted hover:text-fg-strong" title={`Usuń dane ${u.symbol}`} onClick={() => void clear(u.symbol)}>
              <IconTrash size={12} />
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">Świece są cache’em do odtworzenia z EODHD – leżą poza folderem dziennika i nie są synchronizowane.</p>
    </Panel>
  )
}

/** Settings → Skaner. */
export function ScannerSettingsTab({ settings }: { settings: Settings }) {
  const s = settings.scanner
  return (
    <div className="flex flex-col gap-3" data-testid="scanner-settings">
      <KeyPanel />
      <InstrumentsPanel s={s} />
      <DataPanel s={s} />
      <BudgetPanel />
      <CachePanel />
    </div>
  )
}
