import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { dayLevels, levelSessions, levelsWindow, type MarketLevel } from '@shared/calc/marketLevels'
import { ZONE_NY } from '@shared/calc/time'
import { newId } from '@shared/ids'
import type { DayPair, Settings } from '@shared/schema'
import { marketTicker, type MarketBarsResult } from '@shared/market'
import { fmtPrice } from '../../lib/format'
import { marketBars, marketOnline, useMarket } from '../../store/market'
import { navigate } from '../../store/ui'
import { IconPlus } from '../../components/icons'

const nyTime = (ms: number) => DateTime.fromMillis(ms, { zone: ZONE_NY }).toFormat('ccc HH:mm', { locale: 'pl' })

/**
 * Day plan, one pair: ICT levels of the trading day from market bars (PDH/PDL, PWH/PWL, Asia, London, opens) with
 * "+" to copy one into the key levels (or all of them). Levels whose session has not ended yet are not shown.
 */
export function MarketLevelsPanel({
  section,
  date,
  settings,
  readOnly,
  onChange
}: {
  section: DayPair
  date: string
  settings: Settings
  readOnly: boolean
  onChange: (fn: (p: DayPair) => DayPair) => void
}) {
  const status = useMarket((s) => s.status)
  const ticker = marketTicker(section.pair, settings.pairs)
  const [res, setRes] = useState<MarketBarsResult | null>(null)
  const online = marketOnline(status)
  const win = levelsWindow(date)
  // "Now" fixed per opening (levels of today appear as their sessions end after a reopening).
  const [now] = useState(() => Date.now())

  useEffect(() => {
    if (!ticker) return
    let alive = true
    setRes(null)
    void marketBars(ticker, win.fromMs, Math.min(win.toMs, Math.floor(now / 60_000) * 60_000 + 60_000)).then((r) => alive && setRes(r))
    return () => {
      alive = false
    }
  }, [ticker, date, online, win.fromMs, win.toMs, now])

  const levels = useMemo(
    () => (res?.bars.length ? dayLevels(date, res.bars, levelSessions(settings.market.asia, settings.killzones)).filter((l) => l.knownFrom <= now) : []),
    [res, date, settings.market.asia, settings.killzones, now]
  )
  if (!ticker) return null
  const pairCfg = settings.pairs.find((p) => p.symbol === section.pair)
  const decimals = pairCfg?.priceDecimals ?? 5
  const has = (l: MarketLevel) => section.keyLevels.some((k) => k.label.trim().toLowerCase() === l.label.toLowerCase())
  const add = (ls: MarketLevel[]) =>
    onChange((p) => ({ ...p, keyLevels: [...p.keyLevels, ...ls.filter((l) => !p.keyLevels.some((k) => k.label.trim().toLowerCase() === l.label.toLowerCase())).map((l) => ({ id: newId(), price: Number(l.price.toFixed(decimals)), label: l.label }))] }))
  const addable = levels.filter((l) => !has(l))
  return (
    <div className="flex flex-col gap-1" data-testid="market-levels">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="num">{ticker} · dzień 17:00–17:00 NY</span>
        {!readOnly && addable.length > 1 && (
          <button className="btn ml-auto h-[20px] px-1.5 text-[11px]" onClick={() => add(addable)} data-testid="market-levels-add-all">
            Dodaj wszystkie
          </button>
        )}
      </div>
      {!res ? (
        <span className="text-[11.5px] text-muted">wczytuję…</span>
      ) : !levels.length ? (
        <span className="text-[11.5px] text-muted">
          {!res.ok
            ? `Nie udało się pobrać świec: ${res.message}.`
            : online
              ? 'Brak świec z tego okresu.'
              : (
                  <>
                    Brak pobranych świec –{' '}
                    <button className="underline hover:text-fg-strong" onClick={() => navigate({ page: 'settings', tab: 'market' })}>
                      wpisz klucz EODHD
                    </button>
                    .
                  </>
                )}
        </span>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_18px] items-center gap-x-2 gap-y-0.5">
          {levels.map((l) => (
            <div key={l.id} className="contents" data-testid={`market-level-${l.id}`}>
              <span className="text-[12px]">{l.label}</span>
              <span className="num text-right text-[12px] text-fg-strong">{fmtPrice(l.price, decimals)}</span>
              <span className="num text-[11px] text-muted">{nyTime(l.at)}</span>
              {readOnly || has(l) ? (
                <span className="text-center text-[11px] text-dim" title={has(l) ? 'Już w poziomach kluczowych' : undefined}>
                  {has(l) ? '✓' : ''}
                </span>
              ) : (
                <button className="text-muted hover:text-accent" title="Dodaj do poziomów kluczowych" onClick={() => add([l])} aria-label={`Dodaj ${l.label}`}>
                  <IconPlus size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
