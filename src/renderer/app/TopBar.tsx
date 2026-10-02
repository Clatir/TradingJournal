import { useEffect, useState } from 'react'
import { formatClock, primaryKillzone } from '@shared/calc/time'
import type { Killzone } from '@shared/schema'
import { useJournal } from '../store/journal'
import { useDailyLimits } from '../store/derived'
import { fmtR } from '../lib/format'
import { navigate, setPalette } from '../store/ui'
import { IconSearch } from '../components/icons'
import { Kbd, cx } from '../components/ui'
import { SaveIndicator } from './SaveIndicator'

const NO_KILLZONES: readonly Killzone[] = []

function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function TopBar() {
  const now = useNow()
  const killzones = useJournal((s) => s.journal?.settings.killzones ?? NO_KILLZONES)
  const status = useJournal((s) => s.status)
  const iso = now.toISOString()
  const kz = primaryKillzone(iso, killzones)
  const secs = String(now.getUTCSeconds()).padStart(2, '0')
  const limits = useDailyLimits(iso.slice(0, 16))
  const hit = !!limits && (limits.lossLimitHit || limits.maxTradesHit)
  return (
    <header className="flex h-[32px] shrink-0 items-center gap-4 border-b border-line bg-panel pr-3 pl-3">
      <span className="text-[12px] font-semibold tracking-wide text-fg-strong">
        ICT<span className="text-accent">·</span>JOURNAL
      </span>
      {status?.isSample ? (
        <span className="border border-accent bg-accent-soft px-1.5 text-[11px] font-semibold tracking-wider text-accent" data-testid="demo-badge" title="Dane przykładowe – Twoje dane są nietknięte">
          DEMO · dane przykładowe
        </span>
      ) : (
        <span className="max-w-[420px] truncate text-[11px] text-dim" title={status?.dataDir}>
          {status?.dataDir}
        </span>
      )}
      <div className="ml-auto flex items-center gap-4">
        <SaveIndicator />
        {limits && (
          <button
            className={cx('num flex items-center gap-2 border px-2 text-[11.5px]', hit ? 'border-accent/60 bg-accent-soft text-accent' : 'border-transparent text-muted hover:text-fg-strong')}
            onClick={() => navigate({ page: 'calculator' })}
            title="Wynik i liczba transakcji dziś (data NY) względem limitów dziennych"
            data-testid="daily-limits"
          >
            <span>dziś</span>
            <span className={hit ? '' : 'text-fg-strong'}>
              {fmtR(limits.totalR, 1)}
              {limits.lossLimitR != null && <span className="text-dim">/−{limits.lossLimitR}</span>}
            </span>
            <span className={hit ? '' : 'text-fg-strong'}>
              {limits.trades}
              {limits.maxTrades != null && <span className="text-dim">/{limits.maxTrades}</span>}
            </span>
          </button>
        )}
        <div className="flex items-center gap-3 num text-[12px]" data-testid="clock">
          <span>
            <span className="mr-1 text-[10.5px] text-muted">NY</span>
            <span className="text-fg-strong">{formatClock(iso, 'NY')}</span>
            <span className="text-dim">:{secs}</span>
          </span>
          <span>
            <span className="mr-1 text-[10.5px] text-muted">WAW</span>
            <span className="text-fg-strong">{formatClock(iso, 'WAW')}</span>
            <span className="text-dim">:{secs}</span>
          </span>
          <span className={cx('min-w-[86px] text-[11px]', kz ? 'text-accent' : 'text-dim')}>{kz ? kz.name : 'poza KZ'}</span>
        </div>
        <button className="btn h-[22px] gap-2 text-[11.5px] text-muted" onClick={() => setPalette(true)}>
          <IconSearch size={13} /> Szukaj / komendy <Kbd>Ctrl K</Kbd>
        </button>
      </div>
    </header>
  )
}
