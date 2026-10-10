import { marketDiffers, tradeMarketKey } from '@shared/calc/marketStats'
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
