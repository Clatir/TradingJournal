import { DateTime } from 'luxon'
import { liquidityNameMatches, type LevelId } from '@shared/calc/marketLevels'
import { marketDiffers, tradeMarketKey } from '@shared/calc/marketStats'
import { ZONE_NY } from '@shared/calc/time'
import type { Trade } from '@shared/schema'

/**
 * Under MAE / MFE: the market's values (EODHD M1). Equal = the fields came from the market; different (typed, from a
 * TradingView screen or CSV) = the market's values with "Użyj danych rynkowych".
 */
export function MarketExcursions({ trade, marginPips, readOnly, onUse }: { trade: Trade; marginPips: number; readOnly: boolean; onUse: (mae: number, mfe: number) => void }) {
  const m = trade.market
  if (!m) return null
  if (m.maePips == null || m.mfePips == null)
    return (
      <div className="mt-1 text-[11px] text-muted" data-testid="market-excursions">
        Dane rynkowe: {m.warnings[0] ?? 'brak pomiaru'}
      </div>
    )
  const stale = m.key !== tradeMarketKey(trade)
  const differs = marketDiffers(trade, marginPips)
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted" data-testid="market-excursions">
      <span className="num">
        Rynek (EODHD, M1): MAE {m.maePips.toFixed(1)}
        {m.maeMinutes != null ? ` po ${m.maeMinutes} min` : ''} · MFE {m.mfePips.toFixed(1)}
        {m.mfeMinutes != null ? ` po ${m.mfeMinutes} min` : ''}
      </span>
      {stale && <span title="Transakcja zmieniła się po pomiarze – przeliczenie nastąpi w tle">(do przeliczenia)</span>}
      {!differs && !stale && <span className="text-up" data-testid="market-excursions-same">= z danych rynkowych</span>}
      {differs && !readOnly && (
        <button className="btn h-[20px] px-1.5 text-[11px]" onClick={() => onUse(m.maePips!, m.mfePips!)} data-testid="market-use">
          Użyj danych rynkowych
        </button>
      )}
    </div>
  )
}

const OUTCOME: Record<'tp1' | 'tp2' | 'sl' | 'none', string> = { tp1: 'TP1', tp2: 'TP2', sl: 'SL', none: 'nic' }

/** Under "Zebrana płynność": what market bars say price took before the entry; one click marks the matching items. */
export function MarketLiquidity({
  trade,
  pools,
  readOnly,
  onMark
}: {
  trade: Trade
  pools: ReadonlyArray<{ id: string; name: string; archived: boolean }>
  readOnly: boolean
  onMark: (ids: string[]) => void
}) {
  const taken = trade.market?.liquidity ?? []
  if (!trade.market || !taken.length) return null
  const sure = taken.filter((l) => l.touch === 'yes')
  const near = taken.filter((l) => l.touch === 'near')
  const ids = sure.flatMap((l) => pools.filter((p) => !p.archived && liquidityNameMatches(l.id as LevelId, p.name)).map((p) => p.id))
  const missing = ids.filter((id) => !trade.liquidityTakenIds.includes(id))
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted" data-testid="market-liquidity">
      <span>
        Rynek: przed wejściem zebrano {sure.length ? sure.map((l) => l.label).join(', ') : '—'}
        {near.length ? ` · niepewne: ${near.map((l) => l.label).join(', ')}` : ''}
      </span>
      {!readOnly && missing.length > 0 && (
        <button className="btn h-[20px] px-1.5 text-[11px]" onClick={() => onMark([...trade.liquidityTakenIds, ...missing])} data-testid="market-liquidity-mark">
          Zaznacz
        </button>
      )}
    </div>
  )
}

/** In a missed trade: what price reached first after the entry (until 17:00 NY), with "Ustaw" when it differs. */
export function MarketMissed({ trade, readOnly, onSet }: { trade: Trade; readOnly: boolean; onSet: (o: 'tp1' | 'tp2' | 'sl' | 'none') => void }) {
  const m = trade.market?.missed
  if (!m) return trade.market?.warnings.length ? <div className="mt-1 text-[11px] text-muted">Dane rynkowe: {trade.market.warnings[0]}</div> : null
  const at = m.at ? DateTime.fromISO(m.at, { zone: 'utc' }).setZone(ZONE_NY).toFormat('HH:mm') : null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted" data-testid="market-missed">
      <span>
        Z danych rynkowych: <span className="text-fg-strong">{OUTCOME[m.outcome]}</span>
        {at ? ` o ${at} NY` : ' do 17:00 NY'} {m.certain ? '' : '(niepewne – blisko poziomu albo dwa poziomy w tej samej minucie)'}
      </span>
      {!readOnly && trade.missed.hypotheticalOutcome !== m.outcome && (
        <button className="btn h-[20px] px-1.5 text-[11px]" onClick={() => onSet(m.outcome)} data-testid="market-missed-set">
          Ustaw {OUTCOME[m.outcome]}
        </button>
      )}
    </div>
  )
}
