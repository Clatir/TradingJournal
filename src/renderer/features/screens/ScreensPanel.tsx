import { useCallback, useEffect, useRef, useState } from 'react'
import { fileUrl } from '@shared/api'
import type { ScreenPhase, ScreenRef } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { compressImage, imageFilesFrom, typeLabel } from '../../lib/image'
import { fmtBytes } from '../../lib/format'
import { flushSaves, useJournal } from '../../store/journal'
import { openLightbox, toast } from '../../store/ui'
import { IconImage, IconPaste, IconTrash } from '../../components/icons'
import { AnnotationLayer, Annotator } from '../../components/annotations'
import { cx } from '../../components/ui'

export const PHASES: Array<{ id: ScreenPhase; label: string; file: string; key: string }> = [
  { id: 'before', label: 'Przed', file: 'przed', key: 'B' },
  { id: 'during', label: 'W trakcie', file: 'w-trakcie', key: 'T' },
  { id: 'after', label: 'Po', file: 'po', key: 'P' }
]

type Updater = (update: (prev: ScreenRef[]) => ScreenRef[]) => void

const NO_TIMEFRAMES: readonly string[] = []

interface Props {
  screens: ScreenRef[]
  onChange: Updater
  /** Trading date: screens are stored under screens/YYYY/MM. */
  date: string
  withPhases?: boolean
  /** Capture Ctrl+V anywhere on the page. */
  capturePaste?: boolean
  readOnly?: boolean
  labelPrefix?: string
}

export function ScreensPanel({ screens, onChange, date, withPhases = true, capturePaste = false, readOnly, labelPrefix }: Props) {
  const settings = useJournal((s) => s.journal?.settings.screens)
  const timeframes = useJournal((s) => s.journal?.dictionaries.timeframes ?? NO_TIMEFRAMES)
  const [activePhase, setActivePhase] = useState<ScreenPhase>(() => (screens.some((s) => s.phase === 'after') ? 'after' : 'before'))
  const [busy, setBusy] = useState(0)
  const [selected, setSelectedState] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const setSelected = useCallback((id: string | null) => {
    selectedRef.current = id
    setSelectedState(id)
  }, [])
  const [info, setInfo] = useState<Record<string, string>>({})
  const [dropPhase, setDropPhase] = useState<ScreenPhase | 'any' | null>(null)
  const [annotating, setAnnotating] = useState<string | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const ordered = withPhases
    ? PHASES.flatMap((p) => screens.filter((s) => s.phase === p.id)).concat(screens.filter((s) => !s.phase))
    : screens

  const addFiles = useCallback(
    async (files: File[], phase: ScreenPhase | null) => {
      const opts = settingsRef.current
      if (!opts || readOnly) return
      for (const file of files) {
        setBusy((b) => b + 1)
        try {
          const c = await compressImage(file, {
            mode: opts.mode,
            quality: opts.quality,
            autoMaxRatio: opts.autoMaxRatio,
            maxWidth: opts.maxWidth,
            thumbWidth: opts.thumbWidth
          })
          const phaseFile = PHASES.find((p) => p.id === phase)?.file
          const label = [labelPrefix, phaseFile].filter(Boolean).join('-') || 'screen'
          const saved = await api.saveScreen({ date, label, image: c.image, thumb: c.thumb, width: c.width, height: c.height })
          const ref: ScreenRef = { ...saved, phase, timeframe: null, caption: '', annotations: [] }
          onChange((prev) => [...prev, ref])
          const saving = c.originalBytes > 0 ? Math.round((1 - saved.bytes / c.originalBytes) * 100) : 0
          const text =
            `${typeLabel(c.originalType)} ${fmtBytes(c.originalBytes)} → WebP ${fmtBytes(saved.bytes)} (${saving >= 0 ? '−' : '+'}${Math.abs(saving)}%)` +
            (c.lossless ? ' · bezstratnie' : ` · q${opts.quality}`) +
            (c.originalWidth !== c.width ? ` · ${c.originalWidth}→${c.width} px` : '')
          setInfo((m) => ({ ...m, [saved.id]: text }))
          setSelected(saved.id)
          toast(text, 'success')
        } catch (e) {
          toast(`Nie udało się zapisać screena: ${errorMessage(e)}`, 'error', 6000)
        } finally {
          setBusy((b) => b - 1)
        }
      }
    },
    [date, onChange, readOnly, labelPrefix, setSelected]
  )

  useEffect(() => {
    if (!capturePaste || readOnly) return
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData)
      if (files.length === 0) return
      e.preventDefault()
      void addFiles(files, withPhases ? activePhase : null)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [capturePaste, readOnly, addFiles, activePhase, withPhases])

  // Quick timeframe labelling of the selected (just-added) screen: keys 1..9.
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      const current = selectedRef.current
      if (!current) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= timeframes.length) {
        e.preventDefault()
        const tf = timeframes[n - 1] ?? null
        onChange((prev) => prev.map((s) => (s.id === current ? { ...s, timeframe: tf } : s)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [timeframes, onChange, readOnly])

  const update = (id: string, patch: Partial<ScreenRef>) => onChange((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const remove = (screen: ScreenRef) => {
    onChange((prev) => prev.filter((s) => s.id !== screen.id))
    // Once the record without this screen is saved, its files are orphans and can go to the bin.
    setTimeout(async () => {
      try {
        await flushSaves()
        await api.deleteScreens([screen.path])
      } catch {
        /* stays in the orphan list in settings */
      }
    }, 0)
  }

  const dropProps = (phase: ScreenPhase | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (readOnly || !Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setDropPhase(phase ?? 'any')
    },
    onDragLeave: () => setDropPhase(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropPhase(null)
      const files = imageFilesFrom(e.dataTransfer)
      if (files.length) void addFiles(files, phase)
    }
  })

  const card = (s: ScreenRef) => (
    <div
      key={s.id}
      data-testid="screen-card"
      className={cx(
        'group flex min-w-0 flex-col border bg-bg transition-colors duration-150',
        selected === s.id ? 'border-accent/70' : 'border-line hover:border-line-strong'
      )}
      onClick={() => setSelected(s.id)}
    >
      <button
        type="button"
        className="relative aspect-video w-full overflow-hidden bg-black"
        onClick={() => openLightbox(ordered, ordered.indexOf(s))}
        title="Otwórz (pełna rozdzielczość)"
      >
        <img src={fileUrl(s.thumbPath)} alt="" loading="lazy" draggable={false} className="h-full w-full object-fill" />
        <AnnotationLayer annotations={s.annotations} width={s.width} height={s.height} />
        {s.timeframe && <span className="num absolute top-1 left-1 bg-black/75 px-1 text-[10.5px] text-fg-strong">{s.timeframe}</span>}
        {s.annotations.length > 0 && <span className="num absolute top-1 right-1 bg-black/75 px-1 text-[10px] text-accent">✎{s.annotations.length}</span>}
      </button>
      {!readOnly && (
        <div className="flex flex-col gap-1 p-1">
          <div className="flex flex-wrap gap-px">
            {timeframes.map((tf, i) => (
              <button
                key={tf}
                type="button"
                title={`Klawisz ${i + 1}`}
                aria-pressed={s.timeframe === tf}
                onClick={(e) => {
                  e.stopPropagation()
                  update(s.id, { timeframe: s.timeframe === tf ? null : tf })
                }}
                className={cx(
                  'num h-[18px] min-w-[26px] px-1 text-[10.5px]',
                  s.timeframe === tf ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg-strong'
                )}
              >
                {tf}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              className="input h-[22px] text-[11.5px]"
              placeholder="Podpis…"
              value={s.caption}
              onChange={(e) => update(s.id, { caption: e.currentTarget.value })}
            />
            {withPhases && (
              <select
                className="input h-[22px] w-[78px] px-1 text-[11px]"
                value={s.phase ?? ''}
                onChange={(e) => update(s.id, { phase: (e.currentTarget.value || null) as ScreenPhase | null })}
                aria-label="Faza"
              >
                {PHASES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn-ghost h-[22px] px-1 text-[11px] text-muted hover:text-accent"
              title="Adnotacje: strzałki, strefy, poziomy, tekst"
              onClick={(e) => {
                e.stopPropagation()
                setAnnotating(s.id)
              }}
              data-testid="annotate"
            >
              ✎
            </button>
            <button type="button" className="btn btn-ghost h-[22px] px-1 text-muted hover:text-down" title="Usuń screen" onClick={() => remove(s)}>
              <IconTrash size={13} />
            </button>
          </div>
          {info[s.id] && <div className="num truncate text-[10.5px] text-muted" title={info[s.id]}>{info[s.id]}</div>}
        </div>
      )}
    </div>
  )

  const zone = (phase: ScreenPhase | null, label: string | null, items: ScreenRef[]) => {
    const active = withPhases ? phase === activePhase : true
    return (
      <div
        key={phase ?? 'all'}
        {...dropProps(phase)}
        onClick={() => phase && setActivePhase(phase)}
        className={cx(
          'flex flex-col gap-1.5 border p-1.5 transition-colors duration-150',
          dropPhase === (phase ?? 'any') ? 'border-accent bg-accent-soft' : active && withPhases ? 'border-line-strong' : 'border-line'
        )}
        data-testid={`screen-zone-${phase ?? 'all'}`}
      >
        {label && (
          <div className="flex items-center gap-2">
            <span className={cx('label', active && 'text-accent')}>{label}</span>
            {active && !readOnly && <span className="text-[10.5px] text-dim">← Ctrl+V wkleja tutaj</span>}
            <span className="ml-auto num text-[10.5px] text-dim">{items.length || ''}</span>
          </div>
        )}
        {items.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5">{items.map(card)}</div>
        ) : (
          <div className="flex h-[46px] items-center justify-center gap-2 text-[11.5px] text-dim">
            <IconImage size={14} /> {readOnly ? 'brak screenów' : 'przeciągnij obraz lub wklej Ctrl+V'}
          </div>
        )}
      </div>
    )
  }

  const annotated = annotating ? screens.find((x) => x.id === annotating) : null

  return (
    <div className="flex flex-col gap-1.5" {...dropProps(withPhases ? activePhase : null)}>
      {annotated && (
        <Annotator
          screen={annotated}
          onChange={(annotations) => onChange((prev) => prev.map((x) => (x.id === annotated.id ? { ...x, annotations } : x)))}
          onClose={() => setAnnotating(null)}
        />
      )}
      {withPhases
        ? PHASES.map((p) => zone(p.id, p.label, screens.filter((s) => s.phase === p.id)))
        : zone(null, null, screens)}
      {withPhases && screens.some((s) => !s.phase) && zone(null, 'Bez fazy', screens.filter((s) => !s.phase))}
      <div className="flex items-center gap-2 text-[11px] text-dim">
        {busy > 0 ? (
          <span className="text-accent">Kompresja i zapis… ({busy})</span>
        ) : (
          <>
            <IconPaste size={13} />
            <span>
              Ctrl+V – wklej ze schowka{withPhases ? ' do aktywnej fazy' : ''} · klawisze 1–{timeframes.length} nadają interwał ostatniemu screenowi
            </span>
          </>
        )}
      </div>
    </div>
  )
}
