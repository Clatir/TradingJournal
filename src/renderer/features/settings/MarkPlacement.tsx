import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { MARK_SIZES, markPositionAt, type MarkPosition } from '@shared/screenMark'
import { TimeframeMarkSvg } from '../../components/annotations'
import { Segmented, cx } from '../../components/ui'

/** The mock chart's size in "image pixels": a 1920 × 1080 TradingView screenshot. */
const W = 1920
const H = 1080
const PLOT_RIGHT = 1790
const SAMPLE = 'H1'

type SizeLabel = (typeof MARK_SIZES)[number]['label']

/** Deterministic candles for the mock chart (a small random walk, the same every time). */
function mockCandles() {
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const out: Array<{ x: number; o: number; c: number; h: number; l: number }> = []
  let price = 600
  for (let i = 0; i < 58; i++) {
    const o = price
    const c = Math.min(980, Math.max(200, o + (rnd() - 0.5) * 90 + Math.sin(i / 7) * 18))
    const h = Math.min(o, c) - rnd() * 40
    const l = Math.max(o, c) + rnd() * 40
    out.push({ x: 40 + i * 30, o, c, h, l })
    price = c
  }
  return out
}

/**
 * Settings → Screeny: a mock TradingView chart on which the timeframe mark is placed by clicking or dragging (arrow
 * keys move it, the corner buttons snap it), and its size picked. The place is saved as fractions of the free room,
 * so it fits screens of every size.
 */
export function MarkPlacement({
  position,
  size,
  disabled,
  onChange
}: {
  position: MarkPosition
  size: number
  disabled?: boolean
  onChange: (patch: { position?: MarkPosition; size?: number }) => void
}) {
  const candles = useMemo(mockCandles, [])
  const box = useRef<HTMLDivElement>(null)
  // While dragging, the mark follows the pointer here; the setting is written when the button is released.
  const [draft, setDraft] = useState<MarkPosition | null>(null)
  const shown = draft ?? position

  const at = (e: PointerEvent<HTMLDivElement>): MarkPosition => {
    const r = box.current!.getBoundingClientRect()
    return markPositionAt(W, H, SAMPLE, size, ((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H)
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft(at(e))
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (draft) setDraft(at(e))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!draft) return
    const p = at(e)
    setDraft(null)
    onChange({ position: p })
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.01 : 0.05
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d || disabled) return
    e.preventDefault()
    const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
    onChange({ position: { x: r(position.x + d[0]!), y: r(position.y + d[1]!) } })
  }
  const sizeLabel = (MARK_SIZES.find((s) => Math.abs(s.value - size) < 1e-9)?.label ?? null) as SizeLabel | null
  const corners: Array<{ id: string; label: string; title: string; p: MarkPosition }> = [
    { id: 'tl', label: '↖', title: 'Lewy górny róg', p: { x: 0, y: 0 } },
    { id: 'tr', label: '↗', title: 'Prawy górny róg', p: { x: 1, y: 0 } },
    { id: 'bl', label: '↙', title: 'Lewy dolny róg', p: { x: 0, y: 1 } },
    { id: 'br', label: '↘', title: 'Prawy dolny róg', p: { x: 1, y: 1 } }
  ]

  return (
    <div className={disabled ? 'pointer-events-none flex flex-col gap-1.5 opacity-50' : 'flex flex-col gap-1.5'} data-testid="tf-mark-placement">
      <div
        ref={box}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Położenie znaku interwału na screenie"
        aria-valuetext={`${Math.round(shown.x * 100)}% od lewej, ${Math.round(shown.y * 100)}% od góry`}
        className="relative w-[384px] max-w-full cursor-crosshair touch-none select-none border border-line-strong outline-none focus-visible:border-accent"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDraft(null)}
        onKeyDown={key}
        data-testid="tf-mark-mockup"
        data-x={shown.x}
        data-y={shown.y}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <rect width={W} height={H} fill="#131722" />
          {[180, 360, 540, 720, 900].map((y) => (
            <line key={y} x1={0} x2={PLOT_RIGHT} y1={y} y2={y} stroke="#1f2430" strokeWidth={2} />
          ))}
          {[300, 700, 1100, 1500].map((x) => (
            <line key={x} x1={x} x2={x} y1={0} y2={1010} stroke="#1f2430" strokeWidth={2} />
          ))}
          {candles.map((c) => {
            const up = c.c < c.o
            const color = up ? '#089981' : '#f23645'
            return (
              <g key={c.x}>
                <line x1={c.x + 9} x2={c.x + 9} y1={c.h} y2={c.l} stroke={color} strokeWidth={3} />
                <rect x={c.x} y={Math.min(c.o, c.c)} width={18} height={Math.max(3, Math.abs(c.c - c.o))} fill={color} />
              </g>
            )
          })}
          <line x1={PLOT_RIGHT} x2={PLOT_RIGHT} y1={0} y2={H} stroke="#2a2e39" strokeWidth={2} />
          <line x1={0} x2={W} y1={1010} y2={1010} stroke="#2a2e39" strokeWidth={2} />
          {[180, 360, 540, 720, 900].map((y, i) => (
            <text key={y} x={PLOT_RIGHT + 18} y={y + 10} fill="#787b86" fontSize={26} fontFamily="sans-serif">
              {(1.172 - i * 0.002).toFixed(4)}
            </text>
          ))}
          <text x={24} y={46} fill="#b2b5be" fontSize={30} fontFamily="sans-serif">
            Euro / U.S. Dollar · 1h · OANDA
          </text>
        </svg>
        <TimeframeMarkSvg timeframe={SAMPLE} width={W} height={H} position={shown} size={size} testId="tf-mark-preview" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-muted">Rozmiar</span>
        <Segmented<SizeLabel>
          size="sm"
          value={sizeLabel}
          onChange={(l) => onChange({ size: MARK_SIZES.find((s) => s.label === l)!.value })}
          options={MARK_SIZES.map((s) => ({ value: s.label, label: s.label }))}
          aria-label="Rozmiar znaku interwału"
        />
        <span className="ml-2 text-[11.5px] text-muted">Róg</span>
        <div className="inline-flex border border-line-strong">
          {corners.map((c, i) => (
            <button
              key={c.id}
              type="button"
              title={c.title}
              className={cx('h-[22px] w-[26px] text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-fg-strong', i > 0 && 'border-l border-line-strong')}
              onClick={() => onChange({ position: c.p })}
              data-testid={`tf-mark-corner-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <span className="text-[11px] text-muted">
        Kliknij albo przeciągnij znak na wykresie (strzałki: krok 5%, z Shift 1%). Położenie jest względne, więc pasuje do screenów każdej wielkości.
      </span>
    </div>
  )
}
