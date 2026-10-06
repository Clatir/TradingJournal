import { createTrade } from '@shared/defaults'
import type { Trade } from '@shared/schema'

/** A closed long with SL 10 pips and the given result in R, entered at `entryTime`. */
export function closedTradeAt(entryTime: string, r: number, over: Partial<Trade> = {}): Trade {
  return createTrade({
    pair: 'EURUSD',
    direction: 'long',
    entryTime,
    riskPercent: 1,
    prices: { entry: 1.08, stopLoss: 1.079, takeProfit1: 1.083, takeProfit2: null },
    exits: [{ id: '01K6H3Z0W8Q4M2N5P7R9S1T3V5', time: entryTime, price: Number((1.08 + r * 0.001).toFixed(5)), percent: 100, note: '' }],
    ...over
  })
}
