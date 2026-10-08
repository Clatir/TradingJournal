/**
 * Trading rules validator. It never blocks saving – it only flags.
 * Every rule yields pass / fail / na (not applicable: missing data) / info (informational only).
 */
import type { DayPlan } from '../schema/day'
import type { Settings } from '../schema/journal'
import type { Trade } from '../schema/trade'
import { continuationDetail, type ContinuationCheck } from './continuation'
import { formatClock } from './time'
import type { TradeMetrics } from './trade'

export type RuleId = 'maxStopPips' | 'minRiskReward' | 'killzone' | 'htfBias' | 'stopBeyondLiquidity' | 'newsDay'
export type RuleStatus = 'pass' | 'fail' | 'na' | 'info'

export interface RuleResult {
  id: RuleId
  label: string
  status: RuleStatus
  detail: string
  /** Informational rules never change the score. */
  affectsScore: boolean
}

export interface ValidationResult {
  rules: RuleResult[]
  applicable: number
  passed: number
  /** passed / applicable, null when nothing is applicable. */
  score: number | null
  /** All applicable rules passed (null when nothing is applicable). */
  compliant: boolean | null
  broken: RuleResult[]
}

export const RULE_LABELS: Record<RuleId, string> = {
  maxStopPips: 'SL nie większy niż próg',
  minRiskReward: 'R:R do pierwszego celu',
  killzone: 'Wejście w killzone',
  htfBias: 'Zgodność z biasem HTF',
  stopBeyondLiquidity: 'SL poza oczywistą płynnością',
  newsDay: 'Dzień danych high-impact'
}

const EPS = 1e-9

/**
 * `continuation`: the result of `continuationCheck` for a re-opened trade – a valid one takes the killzone rule from
 * the first entry of the chain; an invalid one is checked as a new entry, with the reason in the detail.
 */
export function validateTrade(trade: Trade, m: TradeMetrics, settings: Settings, day: DayPlan | null, continuation: ContinuationCheck | null = null): ValidationResult {
  const r = settings.rules
  const rules: RuleResult[] = []
  const push = (id: RuleId, status: RuleStatus, detail: string, affectsScore = true) =>
    rules.push({ id, label: RULE_LABELS[id], status, detail, affectsScore })

  if (r.maxStopPips.enabled) {
    // A pair can have its own limit (commodities use another scale of pips).
    const own = settings.pairs.find((p) => p.symbol === trade.pair)?.maxStopPips ?? null
    const limit = own ?? r.maxStopPips.value
    if (m.riskPips == null) push('maxStopPips', 'na', 'brak ceny wejścia lub SL')
    else
      push(
        'maxStopPips',
        m.riskPips <= limit + EPS ? 'pass' : 'fail',
        `SL ${m.riskPips.toFixed(1)} p ${m.riskPips <= limit + EPS ? '≤' : '>'} ${limit} p${own != null ? ` (limit ${trade.pair})` : ''}`
      )
  }

  if (r.minRiskReward.enabled) {
    if (m.rrTp1 == null) push('minRiskReward', 'na', 'brak TP1, wejścia lub SL')
    else
      push(
        'minRiskReward',
        m.rrTp1 + EPS >= r.minRiskReward.value ? 'pass' : 'fail',
        `R:R ${m.rrTp1.toFixed(2)} ${m.rrTp1 + EPS >= r.minRiskReward.value ? '≥' : '<'} ${r.minRiskReward.value}:1`
      )
  }

  if (r.requireKillzone.enabled) {
    if (continuation?.ok) push('killzone', continuation.originKillzones.length ? 'pass' : 'fail', continuationDetail(continuation))
    else {
      const own = m.killzoneNames.length ? m.killzoneNames.join(' + ') : `${formatClock(trade.entryTime, 'NY')} NY – poza killzone`
      push('killzone', m.killzoneNames.length ? 'pass' : 'fail', continuation ? `${own} (nie kontynuacja: ${continuation.reason})` : own)
    }
  }

  if (r.htfBias.enabled) {
    const tf = r.htfBias.timeframe
    const section = day?.pairs.find((p) => p.pair === trade.pair)
    const bias = section?.bias[tf].direction ?? null
    if (!day) push('htfBias', 'na', 'brak planu dnia')
    else if (!section) push('htfBias', 'na', `plan dnia bez sekcji ${trade.pair}`)
    else if (!bias) push('htfBias', 'na', `brak biasu ${tf} w planie`)
    else if (bias === 'neutral') push('htfBias', 'na', `bias ${tf} neutralny`)
    else {
      const ok = (bias === 'bullish' && trade.direction === 'long') || (bias === 'bearish' && trade.direction === 'short')
      push('htfBias', ok ? 'pass' : 'fail', `bias ${tf} ${bias === 'bullish' ? 'bullish' : 'bearish'}, transakcja ${trade.direction === 'long' ? 'long' : 'short'}`)
    }
  }

  if (r.stopBeyondLiquidity.enabled) {
    const v = trade.stopBeyondLiquidity
    push('stopBeyondLiquidity', v === 'yes' ? 'pass' : v === 'no' ? 'fail' : 'na', v === 'yes' ? 'tak' : v === 'no' ? 'nie – SL w oczywistej płynności' : 'nie oceniono')
  }

  if (r.newsDay.enabled) {
    const news = day?.news ?? []
    push(
      'newsDay',
      news.length ? 'info' : 'pass',
      news.length
        ? news
            .slice()
            .sort((a, b) => (a.time < b.time ? -1 : 1))
            .map((n) => `${formatClock(n.time, 'NY')} ${n.currency} ${n.title}`.trim())
            .join(' · ')
        : day
          ? 'brak danych high-impact w planie'
          : 'brak planu dnia',
      false
    )
  }

  const scored = rules.filter((x) => x.affectsScore && (x.status === 'pass' || x.status === 'fail'))
  const passed = scored.filter((x) => x.status === 'pass').length
  const broken = rules.filter((x) => x.status === 'fail')
  return {
    rules,
    applicable: scored.length,
    passed,
    score: scored.length ? passed / scored.length : null,
    compliant: scored.length ? broken.length === 0 : null,
    broken
  }
}

/** Daily risk limits for a set of trades taken on one trading day. */
export interface DailyLimitState {
  date: string
  totalR: number
  trades: number
  lossLimitR: number | null
  maxTrades: number | null
  lossLimitHit: boolean
  maxTradesHit: boolean
}

export function dailyLimitState(
  date: string,
  entries: Array<{ status: Trade['status']; tradingDate: string; resultR: number | null; continuation?: boolean }>,
  settings: Settings
): DailyLimitState {
  const today = entries.filter((e) => e.tradingDate === date && e.status !== 'missed')
  const totalR = today.reduce((s, e) => s + (e.status === 'closed' && e.resultR != null ? e.resultR : 0), 0)
  // A re-opened position (valid continuation) is not another trade; its R counts.
  const count = today.filter((e) => !e.continuation).length
  const lossLimitR = settings.risk.dailyLossLimitR
  const maxTrades = settings.risk.dailyMaxTrades
  return {
    date,
    totalR,
    trades: count,
    lossLimitR,
    maxTrades,
    lossLimitHit: lossLimitR != null && totalR <= -lossLimitR + EPS,
    maxTradesHit: maxTrades != null && count >= maxTrades
  }
}
