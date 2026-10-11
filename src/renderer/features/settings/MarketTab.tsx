import { useEffect, useState } from 'react'
import type { MarketCacheStats, MarketTestResult } from '@shared/market'
import { TICKER_RE, defaultMarketTicker } from '@shared/market'
import type { Settings } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { countLabel, fmtBytes } from '../../lib/format'
import { updateJournal, useJournal } from '../../store/journal'
import { fillMarketStats, forgetMarketBars, loadMarketStatus, marketOnline, setMarketEnabled, setMarketKey, useMarket } from '../../store/market'
import { toast } from '../../store/ui'
import { Badge, Field, NumberField, Panel, Segmented, Toggle } from '../../components/ui'
import { ClockInput } from './SettingsPage'

const setMarket = (patch: Partial<Settings['market']>) =>
  updateJournal((j) => ({ ...j, settings: { ...j.settings, market: { ...j.settings.market, ...patch } } }))

/** Settings → Dane rynkowe: the EODHD key of this computer, shared options, tickers of the pairs, the bar cache. */
export function MarketTab({ settings }: { settings: Settings }) {
  const status = useMarket((s) => s.status)
  const progress = useMarket((s) => s.progress)
  const lastError = useMarket((s) => s.lastError)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const tradeCount = useJournal((s) => Object.values(s.trades).filter((e) => e.record.market && (e.record.market.maePips != null || e.record.market.missed)).length)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<MarketTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<MarketCacheStats | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const m = settings.market

  const loadStats = () => void api.marketCacheStats().then(setStats, () => setStats(null))
  useEffect(() => {
    void loadMarketStatus()
    loadStats()
  }, [])
  useEffect(() => {
    if (!progress) loadStats()
  }, [progress])

  const saveKey = async () => {
    try {
      await setMarketKey(key.trim() || null)
      setKey('')
      setTest(null)
      toast(key.trim() ? 'Zapisano klucz API na tym komputerze.' : 'Usunięto klucz API z tego komputera.', 'success')
    } catch (e) {
      toast(errorMessage(e), 'error', 6000)
    }
  }
  const runTest = async () => {
    setBusy(true)
    try {
      setTest(await api.marketTest())
    } catch (e) {
      setTest({ ok: false, message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const runFill = async () => {
    const r = await fillMarketStats(true)
    if (r.error) toast(`Dane rynkowe: ${r.error}.`, 'error', 7000)
    else if (!r.total) toast('Wszystkie transakcje mają już podsumowanie z danych rynkowych.', 'info')
    else toast(`Dane rynkowe: ${countLabel(r.filled, 'transakcja uzupełniona', 'transakcje uzupełnione', 'transakcji uzupełnionych')} z ${r.total}.`, 'success', 6000)
  }
  const clear = async () => {
    await api.marketClearCache()
    forgetMarketBars()
    setConfirmClear(false)
    loadStats()
    toast('Usunięto pobrane świece z folderu danych (podsumowania transakcji zostają).', 'success')
  }

  return (
    <>
      <Panel title="EODHD – klucz API (ten komputer)">
        <div className="flex flex-col gap-2" data-testid="market-key-panel">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted">Klucz:</span>
            {status?.hasKey ? (
              <span className="num text-fg-strong" data-testid="market-key-hint">
                zapisany {status.keyHint}
              </span>
            ) : (
              <span className="text-muted" data-testid="market-key-hint">
                brak
              </span>
            )}
            {status?.hasKey && (status.encrypted ? <Badge tone="up">zaszyfrowany</Badge> : <Badge>bez szyfrowania systemu</Badge>)}
            {status?.source === 'test' && <Badge tone="accent">serwer testowy</Badge>}
            {status?.source === 'off' && <Badge>połączenie wyłączone</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input w-[300px]"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={status?.hasKey ? 'nowy klucz (zastąpi zapisany)' : 'klucz API z eodhd.com → Settings'}
              onChange={(e) => setKey(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && void saveKey()}
              aria-label="Klucz API EODHD"
              data-testid="market-key-input"
            />
            <button className="btn" disabled={!key.trim()} onClick={() => void saveKey()} data-testid="market-key-save">
              Zapisz klucz
            </button>
            {status?.hasKey && (
              <button className="btn btn-ghost" onClick={() => void setMarketKey(null).then(() => setTest(null))} data-testid="market-key-remove">
                Usuń klucz
              </button>
            )}
            <button className="btn" disabled={!status?.hasKey || busy} onClick={() => void runTest()} data-testid="market-test">
              {busy ? 'Sprawdzam…' : 'Sprawdź połączenie'}
            </button>
          </div>
          {test && (
            <div className={test.ok ? 'text-[12px] text-up' : 'text-[12px] text-down'} data-testid="market-test-result">
              {test.ok
                ? `Połączono. Plan: ${test.plan ?? '?'} · dziś ${test.requests ?? '?'} z ${test.dailyLimit?.toLocaleString('pl-PL') ?? '?'} zapytań.`
                : `Nie udało się: ${test.message}.`}
            </div>
          )}
          <Toggle
            checked={status?.enabled ?? true}
            onChange={(v) => void setMarketEnabled(v)}
            label="Pobieraj dane z EODHD na tym komputerze (wyłączone: tylko świece już zapisane w folderze danych)"
            data-testid="market-enabled"
          />
          <p className="text-[11.5px] leading-relaxed text-muted">
            Klucz zostaje tylko na tym komputerze (w danych aplikacji, zaszyfrowany zabezpieczeniem systemu) – nie trafia do folderu dziennika ani do
            kopii. Na drugim komputerze wpisz go osobno albo korzystaj tylko ze świec pobranych tutaj. Do EODHD wysyłany jest wyłącznie symbol i zakres
            dat; łączy się tylko proces główny aplikacji.
          </p>
        </div>
      </Panel>

      <Panel title="Transakcje z danych rynkowych (wspólne dla komputerów)">
        <div className="flex flex-col gap-2">
          <Toggle
            checked={m.autoFill}
            onChange={(v) => setMarket({ autoFill: v })}
            label="Transakcje: podsumowanie ze świec M1 – zamknięte: MAE / MFE, czas do nich, osiągnięte 1R / 2R / TP, dotknięcie SL, zebrana płynność; missed: co cena osiągnęła najpierw (puste pola są uzupełniane)"
            data-testid="market-autofill"
          />
          <Field label="Margines dotknięcia" hint="EODHD to inne źródło cen niż broker (różnice 0,1–0,6 p na EURUSD): w tym marginesie wynik to „niepewne”">
            <div className="flex items-center gap-2">
              <NumberField className="w-[70px]" value={m.touchMarginPips} onChange={(v) => v != null && v >= 0 && v <= 20 && setMarket({ touchMarginPips: v })} decimals={1} step={0.1} aria-label="Margines dotknięcia w pipsach" data-testid="market-margin" />
              <span className="text-[11.5px] text-muted">pips</span>
            </div>
          </Field>
          <Field label="Wykres transakcji">
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
              <NumberField className="w-[64px]" value={m.chartBeforeMinutes} onChange={(v) => v != null && v >= 10 && setMarket({ chartBeforeMinutes: Math.round(v) })} decimals={0} step={30} aria-label="Minut przed wejściem" />
              min przed wejściem,
              <NumberField className="w-[64px]" value={m.chartAfterMinutes} onChange={(v) => v != null && v >= 0 && setMarket({ chartAfterMinutes: Math.round(v) })} decimals={0} step={30} aria-label="Minut po wyjściu" />
              min po wyjściu, interwał na start
              <Segmented
                size="sm"
                value={m.chartInterval}
                onChange={(v) => setMarket({ chartInterval: v })}
                options={[
                  { value: '1', label: 'M1' },
                  { value: '5', label: 'M5' },
                  { value: '15', label: 'M15' },
                  { value: '60', label: 'H1' }
                ]}
              />
            </div>
          </Field>
          <Field label="Sesja Azji" hint="do poziomów planu dnia i „zebranej płynności”: od godziny w dniu poprzednim do godziny w dniu handlowym (czas NY); Londyn = killzone London">
            <div className="flex items-center gap-2 text-[11.5px] text-muted">
              <ClockInput value={m.asia.start} onChange={(start) => setMarket({ asia: { ...m.asia, start } })} />
              –
              <ClockInput value={m.asia.end} onChange={(end) => setMarket({ asia: { ...m.asia, end } })} />
              NY
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <button className="btn" disabled={readOnly || !!progress} onClick={() => void runFill()} data-testid="market-fill">
              {progress ? `Pobieram… ${progress.done} / ${progress.total}` : 'Uzupełnij wszystkie transakcje'}
            </button>
            <span className="text-[11.5px] text-muted" data-testid="market-filled-count">
              z danymi rynkowymi: {tradeCount}
            </span>
            {!marketOnline(status) && <span className="text-[11.5px] text-muted">bez klucza – tylko świece już zapisane w folderze</span>}
          </div>
          {lastError && (
            <div className="text-[12px] text-down" data-testid="market-error">
              Ostatni błąd: {lastError}.
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Symbole par w EODHD">
        <div className="flex flex-col" data-testid="market-tickers">
          {settings.pairs
            .filter((p) => !p.archived)
            .map((p) => (
              <TickerRow key={p.symbol} symbol={p.symbol} own={p.marketSymbol ?? null} />
            ))}
          <p className="pt-2 text-[11.5px] text-muted">
            Domyślnie para walut i metal to „SYMBOL.FOREX” (np. EURUSD.FOREX, XAUUSD.FOREX). Ropa WTI nie jest dostępna w EODHD (Brent: XBRUSD.FOREX).
          </p>
        </div>
      </Panel>

      <Panel title="Pobrane świece w folderze danych">
        <div className="flex flex-wrap items-center gap-3 text-[12px]" data-testid="market-cache">
          {stats ? (
            <span>
              <span className="num text-fg-strong">{fmtBytes(stats.bytes)}</span> · {countLabel(stats.days, 'dzień', 'dni', 'dni')}
              {stats.tickers.length ? ` · ${stats.tickers.join(', ')}` : ''}
            </span>
          ) : (
            <span className="text-muted">…</span>
          )}
          <span className="text-[11.5px] text-muted">ukryty folder .market/ – synchronizuje się z dziennikiem, poza kopiami ZIP</span>
          {confirmClear ? (
            <>
              <button className="btn border-down/60 text-down" onClick={() => void clear()} data-testid="market-clear-confirm">
                Usuń na pewno
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
                Anuluj
              </button>
            </>
          ) : (
            <button className="btn btn-ghost ml-auto" disabled={readOnly || !stats?.days} onClick={() => setConfirmClear(true)} data-testid="market-clear">
              Wyczyść
            </button>
          )}
        </div>
      </Panel>
    </>
  )
}

function TickerRow({ symbol, own }: { symbol: string; own: string | null }) {
  const def = defaultMarketTicker(symbol)
  const none = own === ''
  const [draft, setDraft] = useState(own && own !== '' ? own : '')
  useEffect(() => setDraft(own && own !== '' ? own : ''), [own])
  const setOwn = (value: string | null) =>
    updateJournal((j) => ({ ...j, settings: { ...j.settings, pairs: j.settings.pairs.map((p) => (p.symbol === symbol ? { ...p, marketSymbol: value } : p)) } }))
  const commit = () => {
    const v = draft.trim().toUpperCase()
    if (!v) return setOwn(null)
    if (!TICKER_RE.test(v)) {
      toast(`„${v}” to nie symbol EODHD (np. EURUSD.FOREX, DXY.INDX).`, 'error', 5000)
      setDraft(own ?? '')
      return
    }
    setOwn(v === def ? null : v)
  }
  const effective = none ? null : own || def
  return (
    <div className="grid grid-cols-[90px_220px_1fr] items-center gap-2 border-b border-line/70 py-1" data-testid={`market-ticker-${symbol}`}>
      <span className="num text-fg-strong">{symbol}</span>
      <input
        className="input num"
        value={draft}
        disabled={none}
        placeholder={def ?? 'brak w EODHD – wpisz symbol'}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        aria-label={`Symbol EODHD dla ${symbol}`}
      />
      <span className="flex items-center gap-3 text-[11.5px] text-muted">
        {effective ? <span className="num">→ {effective}</span> : <span>bez danych rynkowych</span>}
        <Toggle checked={!none} onChange={(v) => setOwn(v ? null : '')} label="dane rynkowe" />
      </span>
    </div>
  )
}
