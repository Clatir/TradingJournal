import { useEffect, useRef, useState } from 'react'
import { fileUrl } from '@shared/api'
import { newId } from '@shared/ids'
import type { Annotation, ScreenRef } from '@shared/schema'
import { api, errorMessage } from '../lib/api'
import { toast } from '../store/ui'
import { IconClose, IconCopy, IconTrash } from './icons'
import { cx } from './ui'

export const ANNOTATION_COLORS = ['#e8a33d', '#ffffff', '#2ebd85', '#f6465d', '#3b82f6']
type Tool = 'select' | 'arrow' | 'rect' | 'hline' | 'text'

function geometry(w: number) {
  return { stroke: Math.max(2, w * 0.0022), font: Math.max(12, w * 0.0135), head: Math.max(8, w * 0.009) }
}

/** SVG overlay drawing annotations in image pixel space (viewBox = natural size), so it scales with the image. */
export function AnnotationLayer({
  annotations,
  width,
  height,
  selectedId,
  onSelect,
  className
}: {
  annotations: Annotation[]
  width: number
  height: number
  selectedId?: string | null
  onSelect?: (id: string) => void
  className?: string
}) {
  if (!annotations.length || !width || !height) return null
  const g = geometry(width)
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cx('pointer-events-none absolute inset-0 h-full w-full', className)}>
      {annotations.map((a) => {
        const x1 = a.x1 * width
        const y1 = a.y1 * height
        const x2 = a.x2 * width
        const y2 = a.y2 * height
        const sel = a.id === selectedId
        const common = {
          stroke: a.color,
          strokeWidth: sel ? g.stroke * 1.8 : g.stroke,
          style: { pointerEvents: onSelect ? ('visiblePainted' as const) : ('none' as const), cursor: onSelect ? 'pointer' : undefined },
          onMouseDown: onSelect
            ? (e: React.MouseEvent) => {
                e.stopPropagation()
                onSelect(a.id)
              }
            : undefined
        }
        if (a.type === 'rect')
          return <rect key={a.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={`${a.color}22`} {...common} />
        if (a.type === 'hline')
          return (
            <g key={a.id}>
              <line x1={0} x2={width} y1={y1} y2={y1} strokeDasharray={`${g.stroke * 4} ${g.stroke * 3}`} {...common} />
              {a.text && (
                <text x={width - g.font * 0.6} y={y1 - g.font * 0.4} fill={a.color} fontSize={g.font} textAnchor="end" fontFamily="Inter, sans-serif" fontWeight={600}>
                  {a.text}
                </text>
              )}
            </g>
          )
        if (a.type === 'text') {
          const pad = g.font * 0.35
          const wText = Math.max(1, a.text.length) * g.font * 0.58 + pad * 2
          return (
            <g key={a.id} {...(onSelect ? { onMouseDown: common.onMouseDown, style: common.style } : {})}>
              <rect x={x1} y={y1 - g.font - pad} width={wText} height={g.font + pad * 2} fill="rgba(11,13,16,0.82)" stroke={a.color} strokeWidth={sel ? g.stroke : g.stroke / 2} />
              <text x={x1 + pad} y={y1} fill={a.color} fontSize={g.font} fontFamily="Inter, sans-serif" fontWeight={600}>
                {a.text}
              </text>
            </g>
          )
        }
        // arrow
        const ang = Math.atan2(y2 - y1, x2 - x1)
        const hx1 = x2 - g.head * 2 * Math.cos(ang - 0.45)
        const hy1 = y2 - g.head * 2 * Math.sin(ang - 0.45)
        const hx2 = x2 - g.head * 2 * Math.cos(ang + 0.45)
        const hy2 = y2 - g.head * 2 * Math.sin(ang + 0.45)
        return (
          <g key={a.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" {...common} />
            <polygon points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`} fill={a.color} stroke="none" style={common.style} onMouseDown={common.onMouseDown} />
          </g>
        )
      })}
    </svg>
  )
}

/** Render the screenshot with its annotations into a PNG (for "copy with annotations"). */
export async function flattenScreen(screen: ScreenRef): Promise<Uint8Array> {
  const blob = await (await fetch(fileUrl(screen.path))).blob()
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const x = c.getContext('2d')!
  x.drawImage(bmp, 0, 0)
  const W = bmp.width
  const H = bmp.height
  const g = geometry(W)
  for (const a of screen.annotations) {
    x.strokeStyle = a.color
    x.fillStyle = a.color
    x.lineWidth = g.stroke
    const x1 = a.x1 * W
    const y1 = a.y1 * H
    const x2 = a.x2 * W
    const y2 = a.y2 * H
    if (a.type === 'rect') {
      x.globalAlpha = 0.13
      x.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
      x.globalAlpha = 1
      x.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
    } else if (a.type === 'hline') {
      x.setLineDash([g.stroke * 4, g.stroke * 3])
      x.beginPath()
      x.moveTo(0, y1)
      x.lineTo(W, y1)
      x.stroke()
      x.setLineDash([])
      if (a.text) {
        x.font = `600 ${g.font}px Inter, sans-serif`
        x.textAlign = 'right'
        x.fillText(a.text, W - g.font * 0.6, y1 - g.font * 0.4)
        x.textAlign = 'left'
      }
    } else if (a.type === 'text') {
      x.font = `600 ${g.font}px Inter, sans-serif`
      const pad = g.font * 0.35
      const w = x.measureText(a.text).width + pad * 2
      x.fillStyle = 'rgba(11,13,16,0.82)'
      x.fillRect(x1, y1 - g.font - pad, w, g.font + pad * 2)
      x.lineWidth = g.stroke / 2
      x.strokeRect(x1, y1 - g.font - pad, w, g.font + pad * 2)
      x.fillStyle = a.color
      x.fillText(a.text, x1 + pad, y1)
    } else {
      const ang = Math.atan2(y2 - y1, x2 - x1)
      x.lineCap = 'round'
      x.beginPath()
      x.moveTo(x1, y1)
      x.lineTo(x2, y2)
      x.stroke()
      x.beginPath()
      x.moveTo(x2, y2)
      x.lineTo(x2 - g.head * 2 * Math.cos(ang - 0.45), y2 - g.head * 2 * Math.sin(ang - 0.45))
      x.lineTo(x2 - g.head * 2 * Math.cos(ang + 0.45), y2 - g.head * 2 * Math.sin(ang + 0.45))
      x.closePath()
      x.fill()
    }
  }
  bmp.close()
  const out = await c.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await out.arrayBuffer())
}

export async function copyScreenWithAnnotations(screen: ScreenRef): Promise<void> {
  try {
    await api.copyImage(await flattenScreen(screen))
    toast('Obraz z adnotacjami skopiowany do schowka.', 'success')
  } catch (e) {
    toast(`Nie udało się skopiować: ${errorMessage(e)}`, 'error')
  }
}

/** Full-screen annotation editor for one screenshot. The image itself is never modified. */
export function Annotator({ screen, onChange, onClose }: { screen: ScreenRef; onChange: (annotations: Annotation[]) => void; onClose: () => void }) {
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(ANNOTATION_COLORS[0] as string)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Annotation | null>(null)
  // The shape being drawn, also kept in a ref: mouse moves are rendered lazily, so a fast drag can end
  // (mouseup) before the last move was rendered – the handler must see the latest point, not a stale render.
  const draftRef = useRef<Annotation | null>(null)
  const setDraftNow = (d: Annotation | null) => {
    draftRef.current = d
    setDraft(d)
  }
  const [textAt, setTextAt] = useState<{ x: number; y: number; hline?: boolean } | null>(null)
  const [text, setText] = useState('')
  const [history, setHistory] = useState<Annotation[][]>([])
  const box = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const annotations = screen.annotations

  // Fit the image into the available area while keeping its aspect ratio.
  useEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => {
      const pw = el.clientWidth - 24
      const ph = el.clientHeight - 24
      const k = Math.min(pw / screen.width, ph / screen.height, 1.5)
      setSize({ w: Math.floor(screen.width * k), h: Math.floor(screen.height * k) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen.width, screen.height])

  const commit = (next: Annotation[]) => {
    setHistory((h) => [...h.slice(-30), annotations])
    onChange(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textAt) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        commit(annotations.filter((a) => a.id !== selected))
        setSelected(null)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        const prev = history.at(-1)
        if (prev) {
          setHistory((h) => h.slice(0, -1))
          onChange(prev)
        }
      } else if (!e.ctrlKey && !e.altKey) {
        const map: Record<string, Tool> = { v: 'select', a: 'arrow', r: 'rect', h: 'hline', t: 'text' }
        const t = map[e.key.toLowerCase()]
        if (t) setTool(t)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const point = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    // Keep focus where it is (the text input appears right away) and avoid text selection while dragging.
    e.preventDefault()
    // preventDefault also keeps an open text field from blurring: a click elsewhere finishes it first.
    if (textAt) {
      finishText()
      return
    }
    const p = point(e)
    if (tool === 'select') {
      setSelected(null)
      return
    }
    if (tool === 'text' || tool === 'hline') {
      setTextAt({ x: p.x, y: p.y, hline: tool === 'hline' })
      setText('')
      return
    }
    setDraftNow({ id: newId(), type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, text: '', color })
  }
  const onMove = (e: React.MouseEvent) => {
    const current = draftRef.current
    if (!current) return
    const p = point(e)
    setDraftNow({ ...current, x2: p.x, y2: p.y })
  }
  const onUp = (e?: React.MouseEvent) => {
    const current = draftRef.current
    if (!current) return
    // The release point counts too (it may differ from the last move event).
    const end = e ? point(e) : { x: current.x2, y: current.y2 }
    const done = { ...current, x2: end.x, y2: end.y }
    if (Math.hypot(done.x2 - done.x1, done.y2 - done.y1) > 0.005) commit([...annotations, done])
    setDraftNow(null)
  }
  // Enter and the blur that follows may both finish the same text: commit it once.
  const finishedText = useRef<object | null>(null)
  const finishText = () => {
    if (!textAt || finishedText.current === textAt) return
    finishedText.current = textAt
    if (text.trim() || textAt.hline) {
      commit([...annotations, { id: newId(), type: textAt.hline ? 'hline' : 'text', x1: textAt.x, y1: textAt.y, x2: 0, y2: 0, text: text.trim(), color }])
    }
    setTextAt(null)
  }

  const shown = draft ? [...annotations, draft] : annotations
  const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
    { id: 'select', label: 'Zaznacz', key: 'V' },
    { id: 'arrow', label: 'Strzałka', key: 'A' },
    { id: 'rect', label: 'Strefa', key: 'R' },
    { id: 'hline', label: 'Poziom', key: 'H' },
    { id: 'text', label: 'Tekst', key: 'T' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-black/92" data-testid="annotator">
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <span className="label mr-2">Adnotacje</span>
        <div className="inline-flex border border-line-strong">
          {TOOLS.map((t, i) => (
            <button
              key={t.id}
              className={cx('h-[24px] px-2 text-[12px]', i > 0 && 'border-l border-line-strong', tool === t.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover')}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
              data-testid={`tool-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-2 flex gap-1">
          {ANNOTATION_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={cx('h-[18px] w-[18px] border', color === c ? 'border-fg-strong' : 'border-line-strong')} style={{ background: c }} aria-label={`Kolor ${c}`} />
          ))}
        </div>
        <button className="btn ml-2 h-[24px]" disabled={!selected} onClick={() => selected && (commit(annotations.filter((a) => a.id !== selected)), setSelected(null))}>
          <IconTrash size={12} /> Usuń (Del)
        </button>
        <span className="text-[11px] text-dim">Ctrl+Z cofnij · obraz pozostaje bez zmian</span>
        <button className="btn ml-auto h-[24px]" onClick={() => void copyScreenWithAnnotations(screen)}>
          <IconCopy size={12} /> Kopiuj z adnotacjami
        </button>
        <button className="btn btn-accent h-[24px]" onClick={onClose} data-testid="annotator-done">
          Gotowe
        </button>
        <button className="btn btn-ghost h-[24px] px-1.5" onClick={onClose} aria-label="Zamknij">
          <IconClose />
        </button>
      </div>
      <div ref={area} className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div
          ref={box}
          className={cx('relative select-none', tool === 'select' ? 'cursor-default' : 'cursor-crosshair')}
          style={size ? { width: size.w, height: size.h } : { visibility: 'hidden' }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          data-testid="annotator-canvas"
        >
          <img src={fileUrl(screen.path)} alt="" draggable={false} className="pointer-events-none block h-full w-full" />
          <AnnotationLayer annotations={shown} width={screen.width} height={screen.height} selectedId={selected} onSelect={tool === 'select' ? setSelected : undefined} />
          {textAt && (
            <input
              autoFocus
              className="input absolute w-[220px]"
              style={{ left: `${textAt.x * 100}%`, top: `${textAt.y * 100}%` }}
              placeholder={textAt.hline ? 'etykieta poziomu (opcjonalnie)' : 'tekst, np. MSS'}
              value={text}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishText()
                if (e.key === 'Escape') setTextAt(null)
              }}
              onBlur={finishText}
              data-testid="annotation-text"
            />
          )}
        </div>
      </div>
    </div>
  )
}
