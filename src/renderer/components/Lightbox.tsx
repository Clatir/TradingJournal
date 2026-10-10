import { useCallback, useEffect, useRef, useState } from 'react'
import { fileUrl } from '@shared/api'
import type { ScreenRef } from '@shared/schema'
import { closeLightbox, useUi } from '../store/ui'
import { fmtBytes } from '../lib/format'
import { IconBack, IconClose, IconNext } from './icons'
import { cx } from './ui'
import { AnnotationLayer, TimeframeMark, copyScreenWithAnnotations, useTimeframeMark } from './annotations'

const PHASE_LABEL = { before: 'Przed', during: 'W trakcie', after: 'Po' } as const

interface View {
  scale: number
  x: number
  y: number
}

/** Fit scale of an image of size w×h inside an element (minus a margin), updated on resize. */
function useFitScale(el: React.RefObject<HTMLDivElement | null>, w: number, h: number): number {
  const [fit, setFit] = useState(1)
  useEffect(() => {
    const node = el.current
    if (!node || !w || !h) return
    const update = () => setFit(Math.max(0.01, Math.min((node.clientWidth - 24) / w, (node.clientHeight - 24) / h, 1)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [el, w, h])
  return fit
}

/**
 * One zoomable/pannable image with its annotation overlay. The element always has the image's natural
 * size; "fit" is simply a computed scale, so annotations stay aligned at every zoom level.
 */
export function ZoomImage({ screen, view, onView }: { screen: ScreenRef; view: View | null; onView: (v: View | null) => void }) {
  const showMark = useTimeframeMark()
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fit = useFitScale(stage, screen.width, screen.height)
  const v = view ?? { scale: fit, x: 0, y: 0 }

  const onWheel = (e: React.WheelEvent) => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect) return
    const factor = Math.exp(-e.deltaY * 0.0015)
    const scale = Math.min(12, Math.max(0.05, v.scale * factor))
    const cx0 = e.clientX - rect.left - rect.width / 2
    const cy0 = e.clientY - rect.top - rect.height / 2
    const k = scale / v.scale
    onView({ scale, x: cx0 - (cx0 - v.x) * k, y: cy0 - (cy0 - v.y) * k })
  }

  return (
    <div
      ref={stage}
      className={cx('relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden', dragging ? 'cursor-grabbing' : 'cursor-grab')}
      onWheel={onWheel}
      onDoubleClick={() => onView(null)}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }
        setDragging(true)
      }}
      onMouseMove={(e) => {
        const d = drag.current
        if (!d) return
        onView({ scale: v.scale, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })
      }}
      onMouseUp={() => {
        drag.current = null
        setDragging(false)
      }}
      onMouseLeave={() => {
        drag.current = null
        setDragging(false)
      }}
    >
      <div
        key={screen.path}
        className="relative shrink-0 animate-fade-in"
        style={{ width: screen.width, height: screen.height, transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})` }}
      >
        <img
          src={fileUrl(screen.path)}
          alt={screen.caption || 'screen'}
          draggable={false}
          className="block h-full w-full select-none"
          style={{ imageRendering: v.scale >= 2 ? 'pixelated' : 'auto' }}
        />
        <AnnotationLayer annotations={screen.annotations} width={screen.width} height={screen.height} />
        {screen.timeframe && showMark && (
          <TimeframeMark timeframe={screen.timeframe} auto={screen.timeframeAuto} width={screen.width} height={screen.height} />
        )}
      </div>
    </div>
  )
}

function caption(s: ScreenRef): string {
  return [s.phase ? PHASE_LABEL[s.phase] : null, s.timeframe, s.caption].filter(Boolean).join(' · ')
}

/** Full-resolution viewer; "Porównaj" shows two screenshots side by side with the same zoom and pan. */
export function Lightbox() {
  const lb = useUi((s) => s.lightbox)
  const [index, setIndex] = useState(0)
  const [view, setView] = useState<View | null>(null)
  const [compare, setCompare] = useState<number | null>(null)

  useEffect(() => {
    if (!lb) return
    setIndex(lb.index)
    setView(null)
    // Opening on a "before" screen with an "after" screen available starts in comparison mode only on request.
    setCompare(null)
  }, [lb])

  const count = lb?.screens.length ?? 0
  const go = useCallback(
    (d: number) => {
      setIndex((i) => (count ? (i + d + count) % count : 0))
      setView(null)
    },
    [count]
  )
  const toggleCompare = useCallback(() => {
    if (!lb) return
    setCompare((c) => {
      if (c != null) return null
      // Prefer the "after" screen as the counterpart of a "before" screen.
      const cur = lb.screens[index]
      const after = lb.screens.findIndex((s, i) => i !== index && s.phase === 'after')
      const before = lb.screens.findIndex((s, i) => i !== index && s.phase === 'before')
      if (cur?.phase === 'before' && after >= 0) return after
      if (cur?.phase === 'after' && before >= 0) return before
      return (index + 1) % lb.screens.length
    })
    setView(null)
  }, [lb, index])

  useEffect(() => {
    if (!lb) return
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[data-testid="annotator"]')) return
      if (e.key === 'Escape') closeLightbox()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === '0') setView(null)
      else if (e.key === '1') setView({ scale: 1, x: 0, y: 0 })
      else if (e.key.toLowerCase() === 'c' && count > 1) toggleCompare()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lb, go, count, toggleCompare])

  if (!lb) return null
  const screen = lb.screens[index]
  if (!screen) return null
  const other = compare != null ? lb.screens[compare] : null

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-black/92" data-testid="lightbox">
      <div className="flex h-[34px] shrink-0 items-center gap-3 border-b border-line bg-panel px-3 text-[12px]">
        <span className="num text-muted">
          {index + 1}/{count}
        </span>
        <span className="truncate text-fg-strong">{caption(screen)}</span>
        <span className="ml-auto num text-dim">
          {screen.width}×{screen.height} · {fmtBytes(screen.bytes)} · {view ? `${Math.round(view.scale * 100)}%` : 'dopasowany'}
        </span>
        <span className="text-dim">kółko: zoom · przeciągnij · 0 dopasuj · 1 = 100%{count > 1 ? ' · C porównaj' : ''}</span>
        {count > 1 && (
          <button className={cx('btn h-[24px]', other && 'btn-accent')} onClick={toggleCompare} data-testid="compare">
            Porównaj
          </button>
        )}
        <button className="btn h-[24px]" onClick={() => void copyScreenWithAnnotations(screen)} title="Kopiuj obraz (z adnotacjami) do schowka">
          Kopiuj
        </button>
        <button className="btn btn-ghost h-[24px] px-1.5" onClick={closeLightbox} aria-label="Zamknij">
          <IconClose />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <ZoomImage screen={screen} view={view} onView={setView} />
        {other && (
          <>
            <div className="w-px shrink-0 bg-line-strong" />
            {/* Same zoom & pan on both sides: compare before/after at the same price area. */}
            <ZoomImage screen={other} view={view} onView={setView} />
          </>
        )}
        {!other && count > 1 && (
          <>
            <button className="btn absolute top-1/2 left-3 h-[40px] -translate-y-1/2 px-1.5" onClick={() => go(-1)} aria-label="Poprzedni">
              <IconBack size={18} />
            </button>
            <button className="btn absolute top-1/2 right-3 h-[40px] -translate-y-1/2 px-1.5" onClick={() => go(1)} aria-label="Następny">
              <IconNext size={18} />
            </button>
          </>
        )}
      </div>
      {other && (
        <div className="flex h-[30px] shrink-0 items-center border-t border-line bg-panel text-[12px]" data-testid="compare-bar">
          <div className="flex flex-1 items-center gap-2 px-3">
            <span className="text-muted">lewy:</span>
            <span className="text-fg-strong">{caption(screen) || screen.path.split('/').pop()}</span>
          </div>
          <div className="flex flex-1 items-center gap-2 border-l border-line px-3">
            <span className="text-muted">prawy:</span>
            <select className="input h-[22px] w-auto" value={compare ?? 0} onChange={(e) => setCompare(Number(e.currentTarget.value))}>
              {lb.screens.map((s, i) => (
                <option key={s.id} value={i}>
                  {i + 1}. {caption(s) || s.path.split('/').pop()}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
