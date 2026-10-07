import { DateTime } from 'luxon'
import type { CalendarDay } from '@shared/calc/analytics'
import { fmtMoneyGrouped, fmtR } from '../../lib/format'

const CELL = 13
const GAP = 2
const DOW = ['pon', 'wt', 'śr', 'czw', 'pt']

function color(r: number, max: number): string {
  if (Math.abs(r) < 1e-9) return '#2b323b'
  const k = 0.25 + 0.75 * Math.min(1, Math.abs(r) / max)
  return r > 0 ? `rgba(46,189,133,${k.toFixed(2)})` : `rgba(246,70,93,${k.toFixed(2)})`
}

/** Mon–Fri calendar of the daily total in R (or in PLN) between two dates (weeks as columns). */
export function CalendarHeatmap({
  days,
  from,
  to,
  onPick,
  metric = 'r'
}: {
  days: Map<string, CalendarDay>
  from: string
  to: string
  onPick?: (date: string) => void
  metric?: 'r' | 'pln'
}) {
  const start = DateTime.fromISO(from).startOf('week')
  const end = DateTime.fromISO(to)
  const weeks = Math.max(1, Math.ceil(end.diff(start, 'days').days / 7) + 1)
  const value = (d: CalendarDay) => (metric === 'pln' ? d.pln : d.totalR)
  const max = Math.max(metric === 'pln' ? 0.01 : 1, ...[...days.values()].map((d) => Math.abs(value(d) ?? 0)))
  const W = 28 + weeks * (CELL + GAP)
  const H = 16 + 5 * (CELL + GAP)
  const cells: React.ReactNode[] = []
  const months: React.ReactNode[] = []
  let lastMonth = -1
  for (let w = 0; w < weeks; w++) {
    const monday = start.plus({ weeks: w })
    if (monday.month !== lastMonth) {
      lastMonth = monday.month
      months.push(
        <text key={`m${w}`} x={28 + w * (CELL + GAP)} y={10} fontSize="9" fill="#7a838e" fontFamily="Inter, sans-serif">
          {monday.setLocale('pl').toFormat('LLL')}
        </text>
      )
    }
    for (let d = 0; d < 5; d++) {
      const date = monday.plus({ days: d })
      if (date > end) continue
      const iso = date.toISODate() as string
      const info = days.get(iso)
      cells.push(
        <rect
          key={iso}
          x={28 + w * (CELL + GAP)}
          y={16 + d * (CELL + GAP)}
          width={CELL}
          height={CELL}
          fill={info ? (value(info) == null ? '#2b323b' : color(value(info)!, max)) : '#161b21'}
          stroke={info ? 'none' : '#1e232a'}
          className={onPick ? 'cursor-pointer' : undefined}
          onClick={() => onPick?.(iso)}
        >
          <title>
            {info
              ? `${iso}: ${fmtR(info.totalR)}${info.pln != null ? ` · ${fmtMoneyGrouped(info.pln, 'PLN')}` : ''} (${info.count} tr.)`
              : iso}
          </title>
        </rect>
      )
    }
  }
  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} role="img" aria-label="Kalendarz wyników" data-testid="calendar-heatmap">
        {months}
        {DOW.map((l, i) => (
          <text key={l} x={0} y={16 + i * (CELL + GAP) + 10} fontSize="9" fill="#4f5862" fontFamily="Inter, sans-serif">
            {l}
          </text>
        ))}
        {cells}
      </svg>
    </div>
  )
}
