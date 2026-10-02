import { useEffect, type ReactNode } from 'react'
import { boot, useJournal } from '../store/journal'
import { navigate, setPalette, useUi, type Route } from '../store/ui'
import { FolderSetup } from '../features/setup/FolderSetup'
import { JournalPage } from '../features/journal/JournalPage'
import { TradeEditor } from '../features/trade/TradeEditor'
import { SettingsPage } from '../features/settings/SettingsPage'
import { SyncPage } from '../features/sync/SyncPage'
import { DayPlanPage, todayNy } from '../features/day/DayPlanPage'
import { CalculatorPage } from '../features/calculator/CalculatorPage'
import { CommandPalette, toggleMoney } from '../features/palette/CommandPalette'
import { newTrade } from '../features/trade/actions'
import { Lightbox } from '../components/Lightbox'
import { Toasts } from '../components/Toasts'
import { IconCalc, IconCalendar, IconGear, IconList, IconPlus, IconSync } from '../components/icons'
import { cx } from '../components/ui'
import { TopBar } from './TopBar'
import { Banners } from './Banners'
import { ErrorBoundary } from './ErrorBoundary'

function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useJournal.getState().phase !== 'ready') return
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setPalette(!useUi.getState().paletteOpen)
      } else if (k === 'n') {
        e.preventDefault()
        setPalette(false)
        newTrade(e.shiftKey ? 'missed' : 'trade')
      } else if (e.key === '1') {
        e.preventDefault()
        navigate({ page: 'journal' })
      } else if (e.key === '2' || k === 'd') {
        e.preventDefault()
        navigate({ page: 'day', date: todayNy() })
      } else if (e.key === '6') {
        e.preventDefault()
        navigate({ page: 'calculator' })
      } else if (e.key === ',') {
        e.preventDefault()
        navigate({ page: 'settings' })
      } else if (e.key === '$' || (e.shiftKey && e.code === 'Digit4')) {
        e.preventDefault()
        toggleMoney()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function NavButton({ active, onClick, label, keys, children, badge, testId }: { active: boolean; onClick: () => void; label: string; keys?: string; children: ReactNode; badge?: number; testId?: string }) {
  return (
    <button
      onClick={onClick}
      title={keys ? `${label} (${keys})` : label}
      data-testid={testId}
      className={cx(
        'relative flex h-[46px] w-full flex-col items-center justify-center gap-0.5 border-l-2 text-[9.5px] transition-colors duration-100',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-transparent text-muted hover:bg-hover hover:text-fg-strong'
      )}
    >
      {children}
      <span>{label}</span>
      {badge ? <span className="num absolute top-1 right-1.5 min-w-[14px] bg-accent px-0.5 text-[9.5px] text-bg">{badge}</span> : null}
    </button>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'journal':
      return <JournalPage />
    case 'trade':
      return <TradeEditor key={route.id} id={route.id} />
    case 'day':
      return <DayPlanPage key={route.date} date={route.date} />
    case 'calculator':
      return <CalculatorPage key={route.tradeId ?? 'calc'} tradeId={route.tradeId} />
    case 'settings':
      return <SettingsPage />
    case 'sync':
      return <SyncPage />
  }
}

export function App() {
  const phase = useJournal((s) => s.phase)
  const route = useUi((s) => s.route)
  const issues = useJournal((s) => s.conflicts.length + s.problems.filter((p) => p.kind !== 'unknown-file').length)
  useGlobalHotkeys()
  useEffect(() => {
    void boot()
  }, [])

  if (phase === 'boot') return <div className="flex h-full items-center justify-center text-muted">Wczytywanie…</div>
  if (phase === 'setup') return <FolderSetup />

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <Banners />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[64px] shrink-0 flex-col border-r border-line bg-panel">
          <NavButton active={route.page === 'journal' || route.page === 'trade'} onClick={() => navigate({ page: 'journal' })} label="Dziennik" keys="Ctrl+1" testId="nav-journal">
            <IconList size={17} />
          </NavButton>
          <NavButton active={route.page === 'day'} onClick={() => navigate({ page: 'day', date: todayNy() })} label="Plan dnia" keys="Ctrl+D" testId="nav-day">
            <IconCalendar size={17} />
          </NavButton>
          <NavButton active={route.page === 'calculator'} onClick={() => navigate({ page: 'calculator' })} label="Kalkulator" keys="Ctrl+6" testId="nav-calc">
            <IconCalc size={17} />
          </NavButton>
          <NavButton active={false} onClick={() => newTrade()} label="Nowa" keys="Ctrl+N" testId="nav-new">
            <IconPlus size={17} />
          </NavButton>
          <div className="flex-1" />
          <NavButton active={route.page === 'sync'} onClick={() => navigate({ page: 'sync' })} label="Synchr." badge={issues} testId="nav-sync">
            <IconSync size={17} />
          </NavButton>
          <NavButton active={route.page === 'settings'} onClick={() => navigate({ page: 'settings' })} label="Ustawienia" keys="Ctrl+," testId="nav-settings">
            <IconGear size={17} />
          </NavButton>
        </nav>
        <main className="min-w-0 flex-1 animate-fade-in" key={route.page === 'trade' ? `trade-${route.id}` : route.page === 'day' ? `day-${route.date}` : route.page}>
          <ErrorBoundary onReset={() => navigate({ page: 'journal' })}>
            <Page route={route} />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <Lightbox />
      <Toasts />
    </div>
  )
}
