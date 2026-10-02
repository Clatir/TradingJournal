import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fileUrl } from '@shared/api'
import { summarize } from '@shared/calc/stats'
import { formatClock, weekdayNy } from '@shared/calc/time'
import type { TradeStatus } from '@shared/schema'
import { fmtPercent, fmtPips, fmtR, fmtRatio, tone, toneClass, WEEKDAY_PL, fmtPrice } from '../../lib/format'
import { dictName, useTradeRows, type TradeRow } from '../../store/derived'
import { useJournal } from '../../store/journal'
import { navigate, openLightbox, useUi } from '../../store/ui'
import { IconCopy, IconImage, IconPlus, IconSearch } from '../../components/icons'
import { Badge, Kbd, Segmented, cx } from '../../components/ui'
import { newTrade } from '../trade/actions'
import { duplicateTradeEntry } from '../duplicate'

const COLS = 'grid-cols-[82px_28px_40px_40px_60px_40px_minmax(64px,0.7fr)_minmax(84px,1.2fr)_50px_40px_38px_50px_58px_44px_minmax(60px,1fr)_24px]'
const STATUS_LABEL: Record<TradeStatus, string> = { closed: 'zamkn.', open: 'otwarta', missed: 'missed' }

type StatusFilter = 'all' | TradeStatus

export function JournalPage() {
  const rows = useTradeRows()
  const journal = useJournal((s) => s.journal)
  const selectedId = useUi((s) => s.selectedTradeId)
  const [query, setQuery] = useState('')
  const [pair, setPair] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [hover, setHover] = useState<{ row: TradeRow; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const be = journal?.settings.stats.breakevenThresholdR ?? 0.1

  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return rows.filter((r) => {
      if (pair && r.trade.pair !== pair) return false
      if (status !== 'all' && r.trade.status !== status) return false
      if (!q) return true
      const hay = [
        r.trade.pair,
        r.m.tradingDate,
        r.trade.notes,
        dictName(journal, 'entryModels', r.trade.entryModelId),
        dictName(journal, 'pdArrays', r.trade.entryPdArrayId),
        ...r.m.killzoneNames,
        ...r.trade.psychology.mistakeTagIds.map((id) => dictName(journal, 'mistakeTags', id))
      ]
        .join(' ')
        .toLowerCase()
      return q.split(/\s+/).every((part) => hay.includes(part))
    })
  }, [rows, deferredQuery, pair, status, journal])

  const summary = useMemo(
    () => summarize(filtered.filter((r) => r.m.countsInStats).map((r) => ({ r: r.m.resultR as number, time: r.m.exitTime ?? r.trade.entryTime })), be),
    [filtered, be]
  )

  const virtualizer = useVirtualizer({ count: filtered.length, getScrollElement: () => scrollRef.current, estimateSize: () => 26, overscan: 24 })

  const selectedIndex = filtered.findIndex((r) => r.trade.id === selectedId)
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : (filtered[0] ?? null)

  const select = (id: string) => useUi.setState({ selectedTradeId: id })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().paletteOpen || useUi.getState().lightbox) return
      const el = document.activeElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing && el !== searchRef.current) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = selectedIndex >= 0 ? selectedIndex : -1
        const next = Math.min(filtered.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)))
        const row = filtered[next]
        if (row) {
          select(row.trade.id)
          virtualizer.scrollToIndex(next, { align: 'auto' })
        }
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault()
        navigate({ page: 'trade', id: selected.trade.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, selectedIndex, selected, virtualizer])

  const pairs = journal?.settings.pairs.filter((p) => !p.archived) ?? []

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* filters */}
        <div className="flex h-[36px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
          <div className="relative w-[210px] shrink-0">
            <IconSearch size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-dim" />
            <input
              ref={searchRef}
              className="input pl-7"
              placeholder="Szukaj: para, model, notatki…  ( / )"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              data-testid="journal-search"
            />
          </div>
          <div className="flex min-w-0 gap-1 overflow-hidden">
            {pairs.map((p) => (
              <button key={p.symbol} className="chip num" aria-pressed={pair === p.symbol} onClick={() => setPair(pair === p.symbol ? null : p.symbol)}>
                {p.symbol}
              </button>
            ))}
          </div>
          <Segmented
            size="sm"
            className="shrink-0"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'Wszystkie' },
              { value: 'closed', label: 'Zamknięte' },
              { value: 'open', label: 'Otwarte' },
              { value: 'missed', label: 'Missed' }
            ]}
          />
          <button className="btn btn-accent ml-auto shrink-0" onClick={() => newTrade()} data-testid="new-trade" title="Nowa transakcja (Ctrl+N)">
            <IconPlus size={13} /> Nowa
          </button>
        </div>

        {/* summary strip */}
        <div className="flex h-[30px] shrink-0 items-center gap-5 border-b border-line px-3 text-[11.5px]">
          <SumItem label="Wpisy" value={String(filtered.length)} />
          <SumItem label="Zamknięte" value={String(summary.count)} />
          <SumItem label="Σ R" value={fmtR(summary.totalR)} cls={toneClass[tone(summary.totalR)]} />
          <SumItem label="Win rate" value={fmtPercent(summary.winRate)} />
          <SumItem label="Expectancy" value={fmtR(summary.expectancy)} cls={toneClass[tone(summary.expectancy)]} />
          <SumItem label="W / L / BE" value={`${summary.wins} / ${summary.losses} / ${summary.breakevens}`} />
        </div>

        {/* table */}
        <div className={cx('grid h-[26px] shrink-0 items-center gap-x-1.5 border-b border-line bg-panel px-2 text-[10.5px] tracking-wide text-muted uppercase', COLS)}>
          <span>Data NY</span>
          <span>Dz.</span>
          <span>NY</span>
          <span>WAW</span>
          <span>Para</span>
          <span>Kier.</span>
          <span>Killzone</span>
          <span>Model</span>
          <span>Status</span>
          <span className="text-right">SL p</span>
          <span className="text-right">R:R</span>
          <span className="text-right">Pips</span>
          <span className="text-right">R</span>
          <span className="text-right" title="Zgodność z zasadami">Zas.</span>
          <span>Błędy</span>
          <span />
        </div>
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-testid="journal-table">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
              {rows.length === 0 ? (
                <>
                  <span>Dziennik jest pusty.</span>
                  <span>
                    <Kbd>Ctrl N</Kbd> dodaje transakcję, <Kbd>Ctrl K</Kbd> otwiera paletę komend.
                  </span>
                </>
              ) : (
                <span>Brak wpisów dla wybranych filtrów.</span>
              )}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const row = filtered[v.index] as TradeRow
                const { trade: t, m } = row
                const isSel = selected?.trade.id === t.id
                return (
                  <div
                    key={t.id}
                    data-testid="journal-row"
                    onClick={() => select(t.id)}
                    onDoubleClick={() => navigate({ page: 'trade', id: t.id })}
                    className={cx(
                      'absolute left-0 grid w-full items-center gap-x-1.5 border-b border-line/70 px-2 text-[12px]',
                      COLS,
                      isSel ? 'bg-accent-soft' : v.index % 2 ? 'bg-white/[0.012] hover:bg-hover' : 'hover:bg-hover'
                    )}
                    style={{ top: v.start, height: 26 }}
                  >
                    <span className="num text-fg-strong">{m.tradingDate}</span>
                    <span className="text-muted">{WEEKDAY_PL[weekdayNy(t.entryTime)]}</span>
                    <span className="num">{formatClock(t.entryTime, 'NY')}</span>
                    <span className="num text-muted">{formatClock(t.entryTime, 'WAW')}</span>
                    <span className="num text-fg-strong">{t.pair}</span>
                    <span className={t.direction === 'long' ? 'text-fg-strong' : 'text-fg'}>{t.direction === 'long' ? 'Long' : 'Short'}</span>
                    <span className="truncate text-muted">{m.killzoneNames.join(', ') || '—'}</span>
                    <span className="truncate">{dictName(journal, 'entryModels', t.entryModelId) || <span className="text-dim">—</span>}</span>
                    <span className={cx('text-[11px]', t.status === 'closed' ? 'text-muted' : 'text-accent')}>{STATUS_LABEL[t.status]}</span>
                    <span className="num text-right">{m.riskPips != null ? m.riskPips.toFixed(1) : '—'}</span>
                    <span className="num text-right">{fmtRatio(m.rrTp1)}</span>
                    <span className={cx('num text-right', t.status === 'missed' ? 'text-dim' : toneClass[tone(m.resultPips)])}>{fmtPips(m.resultPips)}</span>
                    <span className={cx('num text-right font-medium', t.status === 'missed' ? 'text-dim' : toneClass[tone(m.resultR, be)])}>{fmtR(m.resultR)}</span>
                    <span
                      className={cx('num text-right text-[11px]', row.v.compliant === false ? 'text-accent' : 'text-muted')}
                      title={row.v.broken.map((b) => `${b.label}: ${b.detail}`).join('\n') || 'zgodna z zasadami'}
                    >
                      {row.v.score == null ? '—' : `${Math.round(row.v.score * 100)}%`}
                    </span>
                    <span className="truncate text-[11px] text-muted">
                      {t.psychology.mistakeTagIds.map((id) => dictName(journal, 'mistakeTags', id)).join(', ')}
                    </span>
                    <span
                      className="flex items-center justify-end gap-0.5 text-dim"
                      onMouseEnter={(e) => t.screens.length && setHover({ row, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHover(null)}
                    >
                      {t.screens.length > 0 && (
                        <>
                          <IconImage size={12} />
                          <span className="num text-[10.5px]">{t.screens.length}</span>
                        </>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* preview */}
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
        {selected ? <Preview row={selected} be={be} /> : <div className="p-4 text-muted">Zaznacz transakcję.</div>}
      </aside>

      {hover && hover.row.trade.screens[0] && (
        <div className="pointer-events-none fixed z-40 w-[300px] animate-fade-in border border-line-strong bg-black" style={{ left: hover.x - 320, top: Math.min(hover.y - 20, window.innerHeight - 190) }}>
          <img src={fileUrl(hover.row.trade.screens[0].thumbPath)} alt="" className="block w-full" />
        </div>
      )}
    </div>
  )
}

function SumItem({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <span className={cx('num text-fg-strong', cls)}>{value}</span>
    </span>
  )
}

function Preview({ row, be }: { row: TradeRow; be: number }) {
  const journal = useJournal((s) => s.journal)
  const readOnly = useJournal((s) => s.status?.readOnly ?? false) || row.readOnly
  const { trade: t, m } = row
  const pairCfg = journal?.settings.pairs.find((p) => p.symbol === t.pair)
  const dec = pairCfg?.priceDecimals ?? 5
  const line = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-[3px]">
      <span className="text-muted">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col animate-fade-in" key={t.id}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="num text-[14px] font-medium text-fg-strong">{t.pair}</span>
        <span className="text-fg">{t.direction === 'long' ? 'Long' : 'Short'}</span>
        {t.status !== 'closed' && <Badge tone="accent">{STATUS_LABEL[t.status]}</Badge>}
        <span className={cx('num ml-auto text-[16px] font-medium', t.status === 'missed' ? 'text-dim' : toneClass[tone(m.resultR, be)])}>{fmtR(m.resultR)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12px]">
        {line('Wejście NY', <span className="num">{m.tradingDate} {formatClock(t.entryTime, 'NY')}</span>)}
        {line('Wejście WAW', <span className="num">{formatClock(t.entryTime, 'WAW')}</span>)}
        {line('Killzone', m.killzoneNames.join(', ') || 'poza killzone')}
        {line('Wejście / SL', <span className="num">{fmtPrice(t.prices.entry, dec) || '—'} / {fmtPrice(t.prices.stopLoss, dec) || '—'}</span>)}
        {line('TP1 / TP2', <span className="num">{fmtPrice(t.prices.takeProfit1, dec) || '—'} / {fmtPrice(t.prices.takeProfit2, dec) || '—'}</span>)}
        {line('SL / R:R TP1', <span className="num">{m.riskPips != null ? `${m.riskPips.toFixed(1)} p` : '—'} / {fmtRatio(m.rrTp1)}</span>)}
        {line('Pipsy', <span className={cx('num', toneClass[tone(m.resultPips)])}>{fmtPips(m.resultPips)}</span>)}
        {line('Model', dictName(journal, 'entryModels', t.entryModelId) || '—')}
        {line('PD array', [dictName(journal, 'pdArrays', t.entryPdArrayId), dictName(journal, 'pdArrays', t.htfPdArrayId)].filter(Boolean).join(' · HTF ') || '—')}
        {line('Płynność', t.liquidityTakenIds.map((id) => dictName(journal, 'liquidityPools', id)).join(', ') || '—')}
        {line('Błędy', t.psychology.mistakeTagIds.map((id) => dictName(journal, 'mistakeTags', id)).join(', ') || '—')}
        {line('Zgodność', <span className={cx('num', row.v.compliant === false ? 'text-accent' : '')}>{row.v.score == null ? '—' : `${Math.round(row.v.score * 100)}%`}</span>)}
        {row.v.broken.map((b) => (
          <div key={b.id} className="flex gap-1.5 py-[2px] text-[11.5px] text-accent">
            <span>✕</span>
            <span className="truncate" title={b.detail}>
              {b.label}: <span className="num">{b.detail}</span>
            </span>
          </div>
        ))}
        {t.notes && <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-fg">{t.notes}</p>}
        {t.screens.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-1">
            {t.screens.map((s, i) => (
              <button key={s.id} className="relative aspect-video overflow-hidden border border-line bg-black hover:border-line-strong" onClick={() => openLightbox(t.screens, i)}>
                <img src={fileUrl(s.thumbPath)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                {s.timeframe && <span className="num absolute top-0.5 left-0.5 bg-black/75 px-1 text-[10px]">{s.timeframe}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-line p-2">
        <button className="btn flex-1 justify-center" onClick={() => navigate({ page: 'trade', id: t.id })} data-testid="open-trade">
          Otwórz <Kbd>Enter</Kbd>
        </button>
        {!readOnly && (
          <button className="btn" onClick={() => duplicateTradeEntry(t.id)} title="Utwórz kopię tej transakcji (Ctrl+Shift+D)" data-testid="duplicate-selected">
            <IconCopy size={13} /> Duplikuj
          </button>
        )}
      </div>
    </div>
  )
}
