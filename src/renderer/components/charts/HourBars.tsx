import type { Group } from '@shared/calc/analytics'
import { fmtR } from '../../lib/format'

/** Total R by New York entry hour (00–23), SVG columns around a zero line. */
export function HourBars({ groups, height = 120 }: { groups: Group[]; height?: number }) {
  const byHour = new Map(groups.map((g) => [Number(g.key), g]))
  const max = Math.max(0.0001, ...groups.map((g) => Math.abs(g.totalR)))
  const W = 24 * 20
  const mid = height / 2
  return (
    <svg viewBox={`0 0 ${W} ${height + 16}`} className="w-full" role="img" aria-label="Wynik wg godziny NY">
      <line x1="0" x2={W} y1={mid} y2={mid} stroke="#2b323b" strokeWidth="1" />
      {Array.from({ length: 24 }, (_, h) => {
        const g = byHour.get(h)
        const x = h * 20 + 3
        const bh = g ? (Math.abs(g.totalR) / max) * (mid - 4) : 0
        return (
          <g key={h}>
            {g && (
              <rect x={x} width={14} y={g.totalR >= 0 ? mid - bh : mid} height={Math.max(bh, 1)} fill={g.totalR >= 0 ? '#2ebd85' : '#f6465d'} opacity="0.85">
                <title>{`${String(h).padStart(2, '0')}:00 NY · ${g.count} tr. · ${fmtR(g.totalR)}`}</title>
              </rect>
            )}
            {h % 2 === 0 && (
              <text x={x + 7} y={height + 12} textAnchor="middle" fontSize="9" fill={g ? '#c3cbd4' : '#4f5862'} fontFamily="JetBrains Mono, monospace">
                {String(h).padStart(2, '0')}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
