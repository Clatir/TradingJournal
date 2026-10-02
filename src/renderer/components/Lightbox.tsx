import { useCallback, useEffect, useRef, useState } from 'react'
import { fileUrl } from '@shared/api'
import { closeLightbox, useUi } from '../store/ui'
import { fmtBytes } from '../lib/format'
import { IconBack, IconClose, IconNext } from './icons'
import { cx } from './ui'

const PHASE_LABEL = { before: 'Przed', during: 'W trakcie', after: 'Po' } as const

interface View {
  scale: number
  x: number
  y: number
}

/** Full-resolution viewer: the full image is loaded only here (lists use thumbnails). */
export function Lightbox() {
  const lb = useUi((s) => s.lightbox)
  const [index, setIndex] = useState(0)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [fit, setFit] = useState(true)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (lb) setIndex(lb.index)
  }, [lb])

  const reset = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 })
    setFit(true)
  }, [])

  useEffect(reset, [index, reset])

  const count = lb?.screens.length ?? 0
  const go = useCallback((d: number) => setIndex((i) => (count ? (i + d + count) % count : 0)), [count])

  useEffect(() => {
    if (!lb) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === '0') reset()
      else if (e.key === '1') {
        setFit(false)
        setView({ scale: 1, x: 0, y: 0 })
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lb, go, reset])

  if (!lb) return null
  const screen = lb.screens[index]
  if (!screen) return null

  /** Scale at which the image is currently displayed in "fit" mode. */
  const fitScale = () => {
    const img = imgRef.current
    return img && img.naturalWidth ? img.clientWidth / img.naturalWidth : 1
  }

  const onWheel = (e: React.WheelEvent) => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect) return
    const factor = Math.exp(-e.deltaY * 0.0015)
    const startScale = fit ? fitScale() : null
    setFit(false)
    setView((prev) => {
      const v = startScale != null ? { scale: startScale, x: 0, y: 0 } : prev
      const scale = Math.min(12, Math.max(0.1, v.scale * factor))
      // Zoom around the cursor.
      const cx0 = e.clientX - rect.left - rect.width / 2
      const cy0 = e.clientY - rect.top - rect.height / 2
      const k = scale / v.scale
      return { scale, x: cx0 - (cx0 - v.x) * k, y: cy0 - (cy0 - v.y) * k }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-black/92" data-testid="lightbox">
      <div className="flex h-[34px] shrink-0 items-center gap-3 border-b border-line bg-panel px-3 text-[12px]">
        <span className="num text-muted">
          {index + 1}/{count}
        </span>
        {screen.phase && <span className="text-accent">{PHASE_LABEL[screen.phase]}</span>}
        {screen.timeframe && <span className="num text-fg-strong">{screen.timeframe}</span>}
        <span className="truncate text-fg">{screen.caption}</span>
        <span className="ml-auto num text-dim">
          {screen.width}×{screen.height} · {fmtBytes(screen.bytes)} · {fit ? 'dopasowany' : `${Math.round(view.scale * 100)}%`}
        </span>
        <span className="text-dim">kółko: zoom · przeciągnij · 0 dopasuj · 1 = 100%</span>
        <button className="btn btn-ghost h-[24px] px-1.5" onClick={closeLightbox} aria-label="Zamknij">
          <IconClose />
        </button>
      </div>
      <div
        ref={stage}
        className={cx('relative min-h-0 flex-1 overflow-hidden', drag.current ? 'cursor-grabbing' : 'cursor-grab')}
        onWheel={onWheel}
        onDoubleClick={reset}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          if (fit) {
            setView({ scale: fitScale(), x: 0, y: 0 })
            setFit(false)
            drag.current = { x: e.clientX, y: e.clientY, vx: 0, vy: 0 }
            return
          }
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (!d) return
          setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
        onClick={(e) => {
          if (e.target === e.currentTarget && fit) closeLightbox()
        }}
      >
        <div key={screen.path} className="pointer-events-none absolute inset-0 flex animate-pop-in items-center justify-center overflow-visible">
          <img
            ref={imgRef}
            src={fileUrl(screen.path)}
            alt={screen.caption || 'screen'}
            draggable={false}
            className="pointer-events-auto max-w-none shrink-0 select-none"
            style={
              fit
                ? { maxWidth: 'calc(100% - 24px)', maxHeight: 'calc(100% - 24px)' }
                : {
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                    imageRendering: view.scale >= 2 ? 'pixelated' : 'auto'
                  }
            }
          />
        </div>
        {count > 1 && (
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
    </div>
  )
}
