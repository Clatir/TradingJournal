import { useMemo, useState } from 'react'
import type { BrokerFile } from '@shared/api'
import { formatDateTime } from '@shared/calc/time'
import { parseBrokerRows, parseBrokerSheets, type BrokerFormat, type BrokerTable } from '@shared/import/broker'
import { BROKER_ZONES, applyBrokerMatch, guessBrokerCurrency, matchBrokerTrades, tradeFromBroker, type BrokerMatch, type BrokerZone, type MatchStatus } from '@shared/import/match'
import { decodeText, textRows } from '@shared/import/tables'
import { api, errorMessage } from '../../lib/api'
import { countLabel, fmtMoneyGrouped, fmtPrice, toneClass, tone } from '../../lib/format'
import { addRecord, updateRecord, useJournal } from '../../store/journal'
import { navigate, toast } from '../../store/ui'
import { Badge, CurrencyInput, NumberField, Panel, Segmented, Toggle, cx } from '../../components/ui'

const FORMAT: Record<BrokerFormat, string> = { mt4: 'MetaTrader 4', mt5: 'MetaTrader 5', xtb: 'XTB (xStation)', other: 'inny układ kolumn' }

const STATUS: Record<MatchStatus, { label: string; tone: 'accent' | 'up' | 'default' | 'warn' }> = {
  matched: { label: 'dopasowana', tone: 'up' },
  new: { label: 'brak wpisu', tone: 'accent' },
  imported: { label: 'już zaimportowana', tone: 'default' },
  'unknown-symbol': { label: 'nieznany symbol', tone: 'warn' },
  'bad-time': { label: 'zły czas', tone: 'warn' }
}

type Loaded = BrokerTable & { name: string; sheet: string }

function readTable(file: BrokerFile): Loaded | null {
  if (file.sheets) {
    const t = parseBrokerSheets(file.sheets)
    return t ? { ...t, name: file.name } : null
  }
  const t = parseBrokerRows(textRows(decodeText(file.bytes ?? new Uint8Array())))
  return t ? { ...t, name: file.name, sheet: '' } : null
}

/** Settings → Export / import: closed positions from a broker's history matched to (and filling) journal entries. */
export function BrokerImport() {
  const journal = useJournal((s) => s.journal)
  const trades = useJournal((s) => s.trades)
  const drafts = useJournal((s) => s.drafts)
  const readOnly = useJournal((s) => !!s.status?.readOnly)
  const [table, setTable] = useState<Loaded | null>(null)
  const [zone, setZone] = useState<BrokerZone>('mt')
  const [tolerance, setTolerance] = useState(15)
  const [currency, setCurrency] = useState('USD')
  /** Where the currency came from: the file, the results (guessed) or the journal's account. */
  const [currencySource, setCurrencySource] = useState<'file' | 'guess' | 'account'>('account')
  const [overwrite, setOverwrite] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const kept = useMemo(
    () =>
      Object.values(trades)
        .filter((e) => !drafts[e.record.id])
        .map((e) => e.record),
    [trades, drafts]
  )
  const pairs = useMemo(() => journal?.settings.pairs.map((p) => p.symbol) ?? [], [journal])
  const result = useMemo(
    () => (table ? matchBrokerTrades(table.trades, kept, pairs, { zone, toleranceMinutes: tolerance }) : null),
    [table, kept, pairs, zone, tolerance]
  )
  if (!journal) return null

  const pick = async () => {
    setBusy(true)
    try {
      const file = await api.pickBrokerFile()
      if (!file) return
      const t = readTable(file)
      if (!t) {
        toast(`${file.name}: nie znaleziono tabeli pozycji (kolumny Symbol, Typ, Wolumen, czas i cena otwarcia).`, 'error', 8000)
        return
      }
      setTable(t)
      // The zone in the headers ("Open Time (UTC)"), else XTB = Polish time, MetaTrader = server time.
      const z: BrokerZone = t.timeZone ?? (t.format === 'xtb' ? 'Europe/Warsaw' : 'mt')
      setZone(z)
      const guessed = t.currency ? null : guessBrokerCurrency(t.trades, pairs, journal.settings)
      setCurrency(t.currency ?? guessed ?? journal.settings.risk.accountCurrency)
      setCurrencySource(t.currency ? 'file' : guessed ? 'guess' : 'account')
      // Selected: positions with an entry (filled) and without one (new entries); the list shows both before applying.
      const m = matchBrokerTrades(t.trades, kept, pairs, { zone: z, toleranceMinutes: tolerance })
      setSelected(new Set(m.matches.filter((x) => x.status === 'matched' || x.status === 'new').map((x) => x.index)))
    } catch (e) {
      toast(errorMessage(e), 'error', 8000)
    } finally {
      setBusy(false)
    }
  }

  const matches = result?.matches ?? []
  const count = (s: MatchStatus) => matches.filter((m) => m.status === s).length
  const chosen = matches.filter((m) => selected.has(m.index) && (m.status === 'matched' || m.status === 'new'))
  const nFill = chosen.filter((m) => m.status === 'matched').length
  const nNew = chosen.filter((m) => m.status === 'new').length
  const selectBy = (status: MatchStatus) => setSelected((s) => new Set([...s, ...matches.filter((m) => m.status === status).map((m) => m.index)]))

  const apply = () => {
    const now = new Date().toISOString()
    const opts = {
      currency,
      defaultAmountCurrency: journal.settings.risk.legacyAmountCurrency ?? journal.settings.risk.accountCurrency,
      overwrite,
      now,
      zone
    }
    let filled = 0
    let created = 0
    let conflicts = 0
    for (const m of chosen) {
      if (m.status === 'matched' && m.tradeId) {
        if (trades[m.tradeId]?.readOnly) continue
        updateRecord('trades', m.tradeId, (t) => {
          const r = applyBrokerMatch(t, m, opts)
          if (r.note.currencyConflict) conflicts++
          return r.trade
        })
        filled++
      } else if (m.status === 'new') {
        const t = tradeFromBroker(m, opts)
        if (t) {
          addRecord('trades', t)
          created++
        }
      }
    }
    setSelected(new Set())
    toast(
      [
        filled ? `Uzupełniono ${countLabel(filled, 'wpis', 'wpisy', 'wpisów')}` : null,
        created ? `utworzono ${countLabel(created, 'nowy wpis', 'nowe wpisy', 'nowych wpisów')}` : null,
        conflicts ? `wynik bez zmian w ${conflicts} (kwoty wpisu w innej walucie niż konto brokera)` : null
      ]
        .filter(Boolean)
        .join(', ') + '.',
      'success',
      7000
    )
  }

  return (
    <Panel title="Import historii od brokera (MT4, MT5, XTB)">
      <div className="flex flex-col gap-2 text-[12px]" data-testid="broker-import">
        <div className="flex items-center gap-2">
          <button className="btn" disabled={busy} onClick={() => void pick()} data-testid="broker-pick">
            Wybierz plik…
          </button>
          <span className="text-[11.5px] text-muted">
            MetaTrader 4/5: historia → „Zapisz jako raport” (HTML). XTB xStation: historia → zamknięte pozycje → eksport XLSX (także z czasem UTC).
            Także CSV z tych plików. Nic się nie zmienia, dopóki nie klikniesz „Zastosuj”.
          </span>
        </div>
        {table && result && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2" data-testid="broker-summary">
              <span className="num truncate text-fg-strong" title={table.name}>
                {table.name}
                {table.sheet ? ` · ${table.sheet}` : ''}
              </span>
              <span>{FORMAT[table.format]}</span>
              <span>
                {countLabel(table.trades.length, 'pozycja', 'pozycje', 'pozycji')}
                {table.merged ? ` (${countLabel(table.merged, 'partial scalony', 'partiale scalone', 'partiali scalonych')})` : ''}
              </span>
              {table.skipped.length > 0 && (
                <span className="text-muted" title={table.skipped.map((s) => `wiersz ${s.row}: ${s.reason}`).join('\n')}>
                  pominięte wiersze: {table.skipped.length}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2">
                <span className="text-muted">Czas w pliku</span>
                <Segmented size="sm" value={zone} onChange={setZone} options={BROKER_ZONES} />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-muted">Tolerancja wejścia (min)</span>
                <NumberField
                  className="w-[56px]"
                  value={tolerance}
                  onChange={(v) => v != null && v >= 0 && setTolerance(Math.min(v, 24 * 60))}
                  aria-label="Tolerancja wejścia w minutach"
                  data-testid="broker-tolerance"
                />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-muted">Waluta konta u brokera</span>
                <CurrencyInput
                  className="w-[52px]"
                  value={currency}
                  onChange={(v) => {
                    setCurrency(v)
                    setCurrencySource('file')
                  }}
                  aria-label="Waluta konta u brokera"
                  data-testid="broker-currency"
                />
                {currencySource === 'guess' && (
                  <span className="text-[11px] text-muted" title="Plik nie podaje waluty: wynik pozycji porównany z ruchem ceny × loty × kontrakt i kursami." data-testid="broker-currency-guess">
                    rozpoznana z wyników
                  </span>
                )}
                {currencySource === 'account' && <span className="text-[11px] text-muted">plik nie podaje waluty – sprawdź</span>}
              </span>
              <Toggle checked={overwrite} onChange={setOverwrite} label="Nadpisz wpisane ceny, wyjścia, loty i wynik" data-testid="broker-overwrite" />
            </div>
            <div className="flex flex-wrap gap-x-4 text-muted" data-testid="broker-counts">
              <span>
                dopasowane <b className="num text-fg-strong">{count('matched')}</b>
              </span>
              <span>
                bez wpisu <b className="num text-fg-strong">{count('new')}</b>
              </span>
              <span>
                już zaimportowane <b className="num text-fg-strong">{count('imported')}</b>
              </span>
              {count('unknown-symbol') > 0 && (
                <span title="Dodaj parę w Ustawienia → Pary, żeby ją dopasować.">
                  nieznany symbol <b className="num text-fg-strong">{count('unknown-symbol')}</b>
                </span>
              )}
            </div>
            <div className="max-h-[360px] overflow-y-auto border border-line">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-raised text-[10.5px] tracking-wide text-muted uppercase">
                  <tr>
                    <th className="w-[26px] px-1.5 py-1" />
                    <th className="px-1.5 py-1 text-left">Status</th>
                    <th className="px-1.5 py-1 text-left">Wejście (NY)</th>
                    <th className="px-1.5 py-1 text-left">Symbol</th>
                    <th className="px-1.5 py-1 text-left">Kier.</th>
                    <th className="px-1.5 py-1 text-right">Loty</th>
                    <th className="px-1.5 py-1 text-right">Otwarcie → zamknięcie</th>
                    <th className="px-1.5 py-1 text-right">Netto</th>
                    <th className="px-1.5 py-1 text-left">Wpis w dzienniku</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <Row
                      key={m.index}
                      m={m}
                      currency={currency}
                      checked={selected.has(m.index)}
                      linked={m.tradeId ? (trades[m.tradeId]?.record ?? null) : null}
                      onToggle={() =>
                        setSelected((s) => {
                          const n = new Set(s)
                          if (n.has(m.index)) n.delete(m.index)
                          else n.add(m.index)
                          return n
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn h-[24px]" onClick={() => selectBy('matched')}>
                Zaznacz dopasowane
              </button>
              <button className="btn h-[24px]" onClick={() => selectBy('new')} data-testid="broker-select-new">
                Zaznacz bez wpisu
              </button>
              <button className="btn btn-ghost h-[24px]" onClick={() => setSelected(new Set())}>
                Odznacz
              </button>
              <button className="btn btn-accent ml-auto" disabled={readOnly || chosen.length === 0} onClick={apply} data-testid="broker-apply">
                Zastosuj: uzupełnij {nFill}, utwórz {nNew}
              </button>
              <button className="btn btn-ghost" onClick={() => setTable(null)}>
                Zamknij
              </button>
            </div>
            <p className="text-[11.5px] text-muted">
              Dopasowanie: ta sama para (symbol bez końcówek typu .pro), kierunek i czas wejścia w tolerancji – najbliższy wpis. Uzupełniane są puste pola: cena
              wejścia, TP, SL (tylko po stronie straty – SL przesunięty na BE nie mówi nic o ryzyku), wyjścia z czasem (partiale wg wolumenu), loty i wynik netto
              (zysk + prowizja + swap) w walucie konta brokera; „[T/P]” / „[S/L]” z komentarza jako notatka wyjścia. Pozycje bez wpisu stają się
              nowymi wpisami (odznacz te, których nie chcesz). Numer pozycji (bez numeru: symbol, czas i cena otwarcia) zostaje we wpisie, więc ponowny
              import jej nie zdubluje.
            </p>
            {result.journalOnly.length > 0 && (
              <details className="text-[11.5px]" data-testid="broker-journal-only">
                <summary className="cursor-default text-muted">
                  Wpisy w dzienniku bez pozycji w pliku (w okresie pliku): <b className="num text-fg-strong">{result.journalOnly.length}</b>
                </summary>
                <div className="mt-1 flex flex-col">
                  {result.journalOnly.map((t) => (
                    <button key={t.id} className="num text-left hover:text-fg-strong" onClick={() => navigate({ page: 'trade', id: t.id })}>
                      {formatDateTime(t.entryTime, 'NY')} {t.pair} {t.direction === 'long' ? 'long' : 'short'}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

function Row({
  m,
  currency,
  checked,
  linked,
  onToggle
}: {
  m: BrokerMatch
  currency: string
  checked: boolean
  linked: { id: string; entryTime: string; pair: string } | null
  onToggle: () => void
}) {
  const b = m.broker
  const actionable = m.status === 'matched' || m.status === 'new'
  const st = STATUS[m.status]
  return (
    <tr className={cx('border-t border-line/60', !actionable && 'text-muted')} data-testid="broker-row" data-status={m.status}>
      <td className="px-1.5 py-[3px] text-center">
        <input type="checkbox" checked={checked && actionable} disabled={!actionable} onChange={onToggle} aria-label={`Wybierz ${b.tickets.join(', ')}`} />
      </td>
      <td className="px-1.5 py-[3px]">
        <Badge tone={st.tone}>{st.label}</Badge>
      </td>
      <td className="num px-1.5 py-[3px]">{m.openUtc ? formatDateTime(m.openUtc, 'NY') : b.openTime.replace('T', ' ')}</td>
      <td className="num px-1.5 py-[3px]" title={`#${b.tickets.join(', #')}`}>
        {b.symbol}
        {m.pair && m.pair !== b.symbol ? <span className="text-dim"> → {m.pair}</span> : null}
      </td>
      <td className="px-1.5 py-[3px]">{b.direction}</td>
      <td className="num px-1.5 py-[3px] text-right">{b.volume}</td>
      <td className="num px-1.5 py-[3px] text-right">
        {fmtPrice(b.openPrice)} → {b.closePrice != null ? fmtPrice(b.closePrice) : 'otwarta'}
        {b.exits.length > 1 ? <span className="text-dim"> ({b.exits.length} części)</span> : null}
      </td>
      <td className={cx('num px-1.5 py-[3px] text-right', b.net != null && toneClass[tone(b.net)])}>{b.net != null ? fmtMoneyGrouped(b.net, currency) : '—'}</td>
      <td className="num px-1.5 py-[3px]">
        {linked ? (
          <button className="hover:text-fg-strong" onClick={() => navigate({ page: 'trade', id: linked.id })} data-testid="broker-linked">
            {formatDateTime(linked.entryTime, 'NY')}
            {m.diffMinutes ? <span className="text-dim"> · Δ {m.diffMinutes > 0 ? '+' : '−'}{Math.abs(m.diffMinutes)} min</span> : null}
          </button>
        ) : (
          '—'
        )}
      </td>
    </tr>
  )
}
