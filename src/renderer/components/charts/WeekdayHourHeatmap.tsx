import { useMemo, useState } from 'react'
import type { AnalyzedTrade } from '@shared/calc/analytics'
import { HEAT_METRICS, cellValue, hourRange, weekdayHourCells, type HeatCell, type HeatMetric } from '@shared/calc/heatmap'
import { fmtPercent, fmtR } from '../../lib/format'
import { Segmented } from '../ui'

const DAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd']
const CELL_W = 30
const CELL_H = 22
const LEFT = 30
const TOP = 16

function fill(v: number | null, metric: HeatMetric, max: number): string {
  if (v == null) return '#161b21'
  if (metric === 'count' || metric === 'mistakes') {
    if (v === 0) return '#1b2027'
    return `rgba(232,163,61,${(0.2 + 0.8 * Math.min(1, v / max)).toFixed(2)})`
  }
  // Results: green above, red below (win rate around 50%).
  const x = metric === 'winRate' ? v - 0.5 : v
  if (Math.abs(x) < 1e-9) return '#2b323b'
  const k = 0.25 + 0.75 * Math.min(1, Math.abs(x) / max)
  return x > 0 ? `rgba(46,189,133,${k.toFixed(2)})` : `rgba(246,70,93,${k.toFixed(2)})`
}

function label(c: HeatCell): string {
  const wr = c.wins + c.losses ? fmtPercent(c.wins / (c.wins + c.losses), 0) : '—'
  return `${DAYS[c.weekday - 1] ?? ''} ${String(c.hour).padStart(2, '0')}:00–${String(c.hour + 1).padStart(2, '0')}:00 NY · ${c.count} tr. · Σ ${fmtR(c.totalR)} · śr. ${fmtR(c.totalR / c.count)} · WR ${wr} · z błędem ${c.mistakes}`
}

/** Weekday × hour of entry (New York): the chosen metric per cell, details on hover. */
export function WeekdayHourHeatmap({ rows }: { rows: readonly AnalyzedTrade[] }) {
  const [metric, setMetric] = useState<HeatMetric>('totalR')
  const cells = useMemo(() => weekdayHourCells(rows), [rows])
  const [lo, hi] = hourRange(cells)
  // Monday–Friday always; the weekend (Sunday evening opens in New York) only when it has trades.
  const weekdays = [1, 2, 3, 4, 5, ...[6, 7].filter((d) => [...cells.values()].some((c) => c.weekday === d))]
  const values = [...cells.values()].map((c) => cellValue(c, metric)).filter((v): v is number => v != null)
  const max = Math.max(metric === 'winRate' ? 0.5 : 1, ...values.map((v) => Math.abs(metric === 'winRate' ? v - 0.5 : v)))
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  const W = LEFT + hours.length * CELL_W
  const H = TOP + weekdays.length * CELL_H
  const text = (c: HeatCell) => {
    const v = cellValue(c, metric)
    if (v == null) return '—'
    if (metric === 'winRate') return `${Math.round(v * 100)}`
    if (metric === 'count' || metric === 'mistakes') return String(v)
    return v.toFixed(1)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="self-start">
        <Segmented size="sm" value={metric} onChange={setMetric} options={HEAT_METRICS} aria-label="Miara mapy godzin" />
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={H} role="img" aria-label="Mapa godzin" data-testid="hour-heatmap">
          {hours.map((h, i) => (
            <text key={h} x={LEFT + i * CELL_W + CELL_W / 2} y={10} fontSize="9" fill="#7a838e" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
              {String(h).padStart(2, '0')}
            </text>
          ))}
          {weekdays.map((wd, di) => {
            const d = DAYS[wd - 1]!
            return (
              <g key={d}>
                <text x={0} y={TOP + di * CELL_H + CELL_H / 2 + 3} fontSize="9.5" fill="#7a838e" fontFamily="Inter, sans-serif">
                  {d}
                </text>
                {hours.map((h, i) => {
                  const c = cells.get(`${wd}:${h}`)
                  const v = c ? cellValue(c, metric) : null
                  return (
                    <g key={h} data-testid={c ? 'heat-cell' : undefined}>
                      <rect
                        x={LEFT + i * CELL_W}
                        y={TOP + di * CELL_H}
                        width={CELL_W - 2}
                        height={CELL_H - 2}
                        fill={c ? fill(v, metric, max) : '#12161b'}
                        stroke={c ? 'none' : '#1e232a'}
                      >
                        <title>{c ? label(c) : `${d} ${String(h).padStart(2, '0')}:00 NY · brak transakcji`}</title>
                      </rect>
                      {c && (
                        <text
                          x={LEFT + i * CELL_W + (CELL_W - 2) / 2}
                          y={TOP + di * CELL_H + CELL_H / 2 + 2}
                          fontSize="9"
                          fill="#e6e9ec"
                          textAnchor="middle"
                          fontFamily="JetBrains Mono, monospace"
                          pointerEvents="none"
                        >
                          {text(c)}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>
      <span className="text-[11px] text-muted">
        Godzina wejścia w Nowym Jorku. Win rate w % (bez BE); „Błędy” = transakcje z tagiem błędu albo złamaną zasadą. Najedź na pole – szczegóły.
      </span>
    </div>
  )
}
