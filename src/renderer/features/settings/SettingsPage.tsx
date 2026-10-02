import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fileUrl, type ScreensStats } from '@shared/api'
import { newId } from '@shared/ids'
import type { DictionaryKey, DictItem, JournalFile, Killzone, PairConfig, Settings } from '@shared/schema'
import { api, errorMessage } from '../../lib/api'
import { fmtBytes, parseClockInput } from '../../lib/format'
import { flushSaves, openResult, updateJournal, useJournal } from '../../store/journal'
import { navigate, toast, useUi, type SettingsTab } from '../../store/ui'
import { IconFolder, IconPlus, IconSync, IconTrash } from '../../components/icons'
import { Field, NumberField, Panel, Segmented, TextField, Toggle, cx } from '../../components/ui'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'folder', label: 'Folder danych' },
  { id: 'pairs', label: 'Pary' },
  { id: 'killzones', label: "Killzone'y" },
  { id: 'dictionaries', label: 'Słowniki' },
  { id: 'screens', label: 'Screeny' },
  { id: 'display', label: 'Wyświetlanie i ryzyko' }
]

export function SettingsPage() {
  const route = useUi((s) => s.route)
  const tab = (route.page === 'settings' && route.tab) || 'folder'
  const journal = useJournal((s) => s.journal)
  if (!journal) return null
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[190px] shrink-0 flex-col border-r border-line bg-panel py-1">
        <div className="label px-3 py-2">Ustawienia</div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate({ page: 'settings', tab: t.id })}
            className={cx(
              'h-[28px] border-l-2 px-3 text-left transition-colors duration-100',
              tab === t.id ? 'border-accent bg-accent-soft text-fg-strong' : 'border-transparent text-muted hover:bg-hover hover:text-fg-strong'
            )}
            data-testid={`settings-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto flex max-w-[980px] flex-col gap-3">
          {tab === 'folder' && <FolderTab />}
          {tab === 'pairs' && <PairsTab journal={journal} />}
          {tab === 'killzones' && <KillzonesTab journal={journal} />}
          {tab === 'dictionaries' && <DictionariesTab journal={journal} />}
          {tab === 'screens' && <ScreensTab settings={journal.settings} />}
          {tab === 'display' && <DisplayTab settings={journal.settings} />}
        </div>
      </div>
    </div>
  )
}

const setSettings = (fn: (s: Settings) => Settings) => updateJournal((j) => ({ ...j, settings: fn(j.settings) }))

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid items-center gap-2 border-b border-line/70 py-1', className)}>{children}</div>
}

// ---------------------------------------------------------------- folder

function FolderTab() {
  const status = useJournal((s) => s.status)
  const info = useJournal((s) => s.appInfo)
  const loadMs = useJournal((s) => s.loadMs)
  const tradeCount = useJournal((s) => Object.keys(s.trades).length)
  const dayCount = useJournal((s) => Object.keys(s.days).length)
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    void api.getConfig().then((c) => setRecent(c.recentDirs))
  }, [status?.dataDir])
  const switchTo = async (fn: () => ReturnType<typeof api.pickDataDir>) => {
    await flushSaves()
    const ok = await openResult(await fn())
    if (ok) toast('Otwarto folder danych.', 'success')
    else {
      const msg = useJournal.getState().setupMessage
      if (msg) toast(msg, 'error', 6000)
    }
  }
  return (
    <>
      <Panel title="Bieżący folder danych">
        <div className="flex flex-col gap-2">
          <div className="num break-all text-[13px] text-fg-strong" data-testid="data-dir">
            {status?.dataDir}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => api.showInFolder(null)}>
              <IconFolder size={13} /> Pokaż w Eksploratorze
            </button>
            <button className="btn" onClick={() => switchTo(() => api.pickDataDir('open'))}>
              Otwórz inny folder…
            </button>
            <button className="btn" onClick={() => switchTo(() => api.pickDataDir('create'))}>
              <IconPlus size={13} /> Nowy dziennik w innym folderze…
            </button>
            <button className="btn" onClick={() => api.rescan().then(() => toast('Przeskanowano folder.', 'success'))}>
              <IconSync size={13} /> Przeskanuj
            </button>
          </div>
          <p className="text-[11.5px] text-muted">
            Żeby przenieść dane (np. na pendrive lub do OneDrive), zamknij aplikację, przenieś cały folder w Eksploratorze i wskaż go tutaj. Wszystkie
            ścieżki w plikach są względne, więc folder działa w nowym miejscu bez zmian.
          </p>
        </div>
      </Panel>
      <Panel title="Informacje">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
          <Field label="Format danych">
            <span className="num">
              v{status?.folderSchemaVersion} (aplikacja obsługuje v{status?.appSchemaVersion})
            </span>
          </Field>
          <Field label="Wersja aplikacji">
            <span className="num">{info?.version}</span>
          </Field>
          <Field label="Ten komputer">
            <span className="num">{info?.machineName}</span>
          </Field>
          <Field label="Wczytanie">
            <span className="num">
              {tradeCount} transakcji, {dayCount} planów · {loadMs} ms
            </span>
          </Field>
          <Field label="Ustawienia lokalne">
            <span className="num truncate text-[11px] text-muted" title={info?.userDataDir}>
              {info?.userDataDir}
            </span>
          </Field>
        </div>
      </Panel>
      {recent.length > 1 && (
        <Panel title="Ostatnio używane foldery">
          {recent
            .filter((d) => d !== status?.dataDir)
            .map((d) => (
              <Row key={d} className="grid-cols-[1fr_auto]">
                <span className="num truncate text-[12px]">{d}</span>
                <button className="btn h-[22px]" onClick={() => switchTo(() => api.openDataDir(d, false))}>
                  Otwórz
                </button>
              </Row>
            ))}
        </Panel>
      )}
    </>
  )
}

// ---------------------------------------------------------------- pairs

function PairsTab({ journal }: { journal: JournalFile }) {
  const trades = useJournal((s) => s.trades)
  const used = useMemo(() => new Set(Object.values(trades).map((e) => e.record.pair)), [trades])
  const [symbol, setSymbol] = useState('')
  const [quote, setQuote] = useState('USD')
  const setPair = (sym: string, patch: Partial<PairConfig>) =>
    setSettings((s) => ({ ...s, pairs: s.pairs.map((p) => (p.symbol === sym ? { ...p, ...patch } : p)) }))
  const add = () => {
    const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!/^[A-Z0-9]{3,12}$/.test(sym)) return toast('Symbol: 3–12 wielkich liter/cyfr, np. GBPUSD.', 'error')
    if (journal.settings.pairs.some((p) => p.symbol === sym)) return toast('Ta para już jest na liście.', 'error')
    const q = /^[A-Z]{3}$/.test(quote) ? quote : sym.slice(-3)
    const jpy = q === 'JPY'
    setSettings((s) => ({
      ...s,
      pairs: [...s.pairs, { symbol: sym, pipSize: jpy ? 0.01 : 0.0001, priceDecimals: jpy ? 3 : 5, quoteCurrency: q, tvSymbol: `FX:${sym}`, archived: false }]
    }))
    setSymbol('')
  }
  return (
    <Panel title="Pary walutowe">
      <Row className="grid-cols-[100px_100px_80px_80px_1fr_110px] text-[10.5px] tracking-wide text-muted uppercase">
        <span>Symbol</span>
        <span>Wielkość pipsa</span>
        <span>Miejsca</span>
        <span>Kwotowana</span>
        <span>Symbol TradingView</span>
        <span />
      </Row>
      {journal.settings.pairs.map((p) => (
        <Row key={p.symbol} className={cx('grid-cols-[100px_100px_80px_80px_1fr_110px]', p.archived && 'opacity-50')}>
          <span className="num text-fg-strong" title={used.has(p.symbol) ? 'Para użyta w transakcjach – symbolu nie można zmienić' : ''}>
            {p.symbol}
          </span>
          <NumberField value={p.pipSize} onChange={(v) => v && v > 0 && setPair(p.symbol, { pipSize: v })} decimals={undefined} />
          <NumberField value={p.priceDecimals} onChange={(v) => v != null && v >= 0 && v <= 8 && setPair(p.symbol, { priceDecimals: Math.round(v) })} decimals={0} />
          <TextField
            mono
            value={p.quoteCurrency}
            onChange={(v) => {
              const q = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
              if (q.length === 3) setPair(p.symbol, { quoteCurrency: q })
            }}
          />
          <TextField mono value={p.tvSymbol} onChange={(v) => setPair(p.symbol, { tvSymbol: v.trim() })} />
          <button className="btn h-[22px]" onClick={() => setPair(p.symbol, { archived: !p.archived })}>
            {p.archived ? 'Przywróć' : 'Ukryj'}
          </button>
        </Row>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <TextField mono className="w-[110px]" value={symbol} onChange={(v) => setSymbol(v.toUpperCase())} placeholder="np. GBPUSD" />
        <TextField mono className="w-[70px]" value={quote} onChange={(v) => setQuote(v.toUpperCase().slice(0, 3))} placeholder="USD" />
        <button className="btn" onClick={add}>
          <IconPlus size={13} /> Dodaj parę
        </button>
        <span className="text-[11px] text-muted">Pary z JPY dostają pips 0.01. Ukryte pary znikają z wyboru, historia zostaje.</span>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- killzones

function ClockInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input num w-[64px] text-center"
      value={draft ?? value}
      aria-invalid={draft != null && !parseClockInput(draft)}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        const c = draft != null ? parseClockInput(draft) : null
        if (c) onChange(c)
        setDraft(null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

function KillzonesTab({ journal }: { journal: JournalFile }) {
  const setKz = (id: string, patch: Partial<Killzone>) =>
    setSettings((s) => ({ ...s, killzones: s.killzones.map((k) => (k.id === id ? { ...k, ...patch } : k)) }))
  return (
    <Panel title="Killzone'y (czas Nowego Jorku)">
      <p className="mb-2 text-[11.5px] text-muted">
        Godziny w czasie NY – aplikacja sama uwzględnia różne daty zmiany czasu w USA i UE. Killzone transakcji jest wykrywana z czasu wejścia; okno
        przez północ (np. 20:00–00:00) jest obsługiwane.
      </p>
      <Row className="grid-cols-[1fr_70px_70px_140px_110px] text-[10.5px] tracking-wide text-muted uppercase">
        <span>Nazwa</span>
        <span>Od</span>
        <span>Do</span>
        <span>Rodzaj</span>
        <span />
      </Row>
      {journal.settings.killzones.map((k) => (
        <Row key={k.id} className={cx('grid-cols-[1fr_70px_70px_140px_110px]', k.archived && 'opacity-50')}>
          <TextField value={k.name} onChange={(v) => v.trim() && setKz(k.id, { name: v })} />
          <ClockInput value={k.start} onChange={(v) => setKz(k.id, { start: v })} />
          <ClockInput value={k.end} onChange={(v) => setKz(k.id, { end: v })} />
          <Segmented
            size="sm"
            value={k.kind}
            onChange={(v) => setKz(k.id, { kind: v })}
            options={[
              { value: 'killzone', label: 'Killzone' },
              { value: 'silverBullet', label: 'SB' }
            ]}
          />
          <button className="btn h-[22px]" onClick={() => setKz(k.id, { archived: !k.archived })}>
            {k.archived ? 'Przywróć' : 'Wyłącz'}
          </button>
        </Row>
      ))}
      <button
        className="btn mt-2"
        onClick={() =>
          setSettings((s) => ({ ...s, killzones: [...s.killzones, { id: newId(), name: 'Nowa', start: '20:00', end: '00:00', kind: 'killzone', archived: false }] }))
        }
      >
        <IconPlus size={13} /> Dodaj
      </button>
    </Panel>
  )
}

// ---------------------------------------------------------------- dictionaries

const DICTS: Array<{ key: DictionaryKey; label: string; hint: string }> = [
  { key: 'entryModels', label: 'Modele wejścia', hint: 'np. Sweep → MSS → FVG' },
  { key: 'pdArrays', label: 'PD arrays', hint: 'np. FVG, OB, Breaker' },
  { key: 'liquidityPools', label: 'Pule płynności', hint: 'np. PDH, EQL' },
  { key: 'mistakeTags', label: 'Tagi błędów', hint: 'np. Przesunięty TP' },
  { key: 'missedReasons', label: 'Powody missed trades', hint: 'np. Brak potwierdzenia' }
]

function DictionaryEditor({ journal, dictKey, label, hint }: { journal: JournalFile; dictKey: DictionaryKey; label: string; hint: string }) {
  const [name, setName] = useState('')
  const items = journal.dictionaries[dictKey]
  const setItems = (fn: (items: DictItem[]) => DictItem[]) =>
    updateJournal((j) => ({ ...j, dictionaries: { ...j.dictionaries, [dictKey]: fn(j.dictionaries[dictKey]) } }))
  const add = () => {
    const n = name.trim()
    if (!n) return
    if (items.some((i) => i.name.toLowerCase() === n.toLowerCase())) return toast('Taka pozycja już istnieje.', 'error')
    setItems((xs) => [...xs, { id: newId(), name: n, archived: false }])
    setName('')
  }
  return (
    <Panel title={label}>
      <div className="flex flex-col">
        {items.map((it) => (
          <Row key={it.id} className={cx('grid-cols-[1fr_96px]', it.archived && 'opacity-50')}>
            <TextField value={it.name} onChange={(v) => v.trim() && setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, name: v } : x)))} />
            <button className="btn h-[22px]" onClick={() => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, archived: !x.archived } : x)))}>
              {it.archived ? 'Przywróć' : 'Archiwizuj'}
            </button>
          </Row>
        ))}
        <div className="mt-2 flex gap-2">
          <input className="input" value={name} placeholder={hint} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn" onClick={add}>
            <IconPlus size={13} /> Dodaj
          </button>
        </div>
      </div>
    </Panel>
  )
}

function DictionariesTab({ journal }: { journal: JournalFile }) {
  const [tf, setTf] = useState('')
  const tfs = journal.dictionaries.timeframes
  const setTfs = (next: string[]) => updateJournal((j) => ({ ...j, dictionaries: { ...j.dictionaries, timeframes: next } }))
  return (
    <>
      <p className="text-[11.5px] text-muted">
        Zmiana nazwy działa wstecz (wpisy trzymają identyfikator). Archiwizacja ukrywa pozycję przy nowych wpisach, ale zostawia ją w historii i
        statystykach.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {DICTS.map((d) => (
          <DictionaryEditor key={d.key} journal={journal} dictKey={d.key} label={d.label} hint={d.hint} />
        ))}
        <Panel title="Interwały screenów (klawisze 1–9 w kolejności)">
          <div className="flex flex-wrap gap-1">
            {tfs.map((t, i) => (
              <span key={t} className="chip gap-1.5">
                <span className="num text-dim">{i + 1}</span>
                <span className="num text-fg-strong">{t}</span>
                <button className="text-dim hover:text-down" onClick={() => setTfs(tfs.filter((x) => x !== t))} aria-label={`Usuń ${t}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input num w-[90px]" value={tf} placeholder="np. M30" onChange={(e) => setTf(e.currentTarget.value.toUpperCase())} />
            <button
              className="btn"
              onClick={() => {
                const v = tf.trim()
                if (v && !tfs.includes(v)) setTfs([...tfs, v])
                setTf('')
              }}
            >
              <IconPlus size={13} /> Dodaj
            </button>
          </div>
        </Panel>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- screens

function ScreensTab({ settings }: { settings: Settings }) {
  const sc = settings.screens
  const [stats, setStats] = useState<ScreensStats | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const load = useCallback(async () => {
    try {
      await flushSaves()
      const s = await api.screensStats()
      setStats(s)
      setSelected(new Set(s.orphans.map((o) => o.path)))
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const setSc = (patch: Partial<Settings['screens']>) => setSettings((s) => ({ ...s, screens: { ...s.screens, ...patch } }))
  const orphanBytes = stats?.orphans.filter((o) => selected.has(o.path)).reduce((s, o) => s + o.bytes, 0) ?? 0
  return (
    <>
      <Panel title="Kompresja screenów (WebP)">
        <div className="flex flex-col gap-2">
          <Field label="Tryb">
            <Segmented
              value={sc.mode}
              onChange={(v) => setSc({ mode: v })}
              options={[
                { value: 'auto', label: 'Auto (zalecane)' },
                { value: 'lossy', label: 'Stratny' },
                { value: 'lossless', label: 'Bezstratnie' }
              ]}
            />
          </Field>
          <Field label="Jakość">
            <div className="flex items-center gap-2">
              <input type="range" min={50} max={100} value={sc.quality} onChange={(e) => setSc({ quality: Number(e.currentTarget.value) })} className="w-[220px] accent-[#e8a33d]" />
              <span className="num w-[32px] text-fg-strong">{sc.quality}</span>
              <span className="text-[11px] text-muted">dla trybu stratnego (i jako alternatywa w trybie auto)</span>
            </div>
          </Field>
          <Field label="Maks. szerokość">
            <div className="flex items-center gap-2">
              <NumberField className="w-[90px]" value={sc.maxWidth} onChange={(v) => v && v >= 320 && setSc({ maxWidth: Math.round(v) })} decimals={0} step={64} />
              <span className="text-[11px] text-muted">px – większe obrazy są zmniejszane, mniejsze nigdy powiększane</span>
            </div>
          </Field>
          <Field label="Miniatura">
            <div className="flex items-center gap-2">
              <NumberField className="w-[90px]" value={sc.thumbWidth} onChange={(v) => v && v >= 120 && setSc({ thumbWidth: Math.round(v) })} decimals={0} step={40} />
              <span className="text-[11px] text-muted">px szerokości (listy i galerie; pełny obraz tylko w podglądzie)</span>
            </div>
          </Field>
          <div className="mt-1 border-t border-line pt-2 text-[11.5px] leading-relaxed text-muted">
            Kalibracja na wykresach w stylu TradingView 1920×1080: bezstratny WebP jest 0,96–1,26× rozmiaru q85–q90 i zachowuje cyfry na osi
            co do piksela, a stratny rozmywa kolorowe etykiety (PDH, ostatnia cena) przez podpróbkowanie koloru. Tryb auto koduje oba warianty i
            wybiera bezstratny, gdy jest najwyżej {sc.autoMaxRatio}× większy – dla wykresów prawie zawsze; dla zdjęć i gradientów zostaje stratny.
          </div>
        </div>
      </Panel>
      <Panel
        title="Folder screenów"
        actions={
          <button className="btn h-[22px]" onClick={() => void load()}>
            <IconSync size={12} /> Odśwież
          </button>
        }
      >
        {stats ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-6 text-[12px]">
              <span>
                Łączny rozmiar: <span className="num text-fg-strong" data-testid="screens-total">{fmtBytes(stats.totalBytes)}</span>
              </span>
              <span>
                Pliki: <span className="num text-fg-strong">{stats.fileCount}</span>
              </span>
              <span>
                Bez powiązanego wpisu: <span className={cx('num', stats.orphans.length ? 'text-accent' : 'text-fg-strong')}>{stats.orphans.length}</span>
              </span>
            </div>
            {stats.orphans.length > 0 && (
              <>
                <div className="grid grid-cols-4 gap-1.5">
                  {stats.orphans.map((o) => (
                    <label key={o.path} className={cx('flex flex-col border bg-bg', selected.has(o.path) ? 'border-accent/60' : 'border-line')}>
                      <img src={fileUrl(o.thumbPath ?? o.path)} alt="" className="aspect-video w-full object-cover object-top" loading="lazy" />
                      <span className="flex items-center gap-1.5 p-1 text-[10.5px]">
                        <input
                          type="checkbox"
                          checked={selected.has(o.path)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s)
                              if (n.has(o.path)) n.delete(o.path)
                              else n.add(o.path)
                              return n
                            })
                          }
                        />
                        <span className="num truncate text-muted" title={o.path}>
                          {o.path.split('/').pop()}
                        </span>
                        <span className="num ml-auto text-dim">{fmtBytes(o.bytes)}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  className="btn self-start border-down/50 text-down"
                  disabled={selected.size === 0}
                  data-testid="delete-orphans"
                  onClick={async () => {
                    try {
                      const n = await api.deleteScreens([...selected])
                      toast(`Przeniesiono do Kosza: ${n} plików.`, 'success')
                      await load()
                    } catch (e) {
                      toast(errorMessage(e), 'error')
                    }
                  }}
                >
                  <IconTrash size={13} /> Usuń zaznaczone ({fmtBytes(orphanBytes)})
                </button>
              </>
            )}
          </div>
        ) : (
          <span className="text-muted">Liczenie…</span>
        )}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------- display & risk

function DisplayTab({ settings }: { settings: Settings }) {
  return (
    <>
      <Panel title="Wyświetlanie">
        <div className="flex flex-col gap-2">
          <Toggle
            checked={settings.display.showMoney}
            onChange={(v) => setSettings((s) => ({ ...s, display: { ...s.display, showMoney: v } }))}
            label="Pokazuj kwoty (domyślnie tylko R i pipsy) – skrót Ctrl+$"
            data-testid="toggle-money"
          />
          <Field label="Wpisywanie czasu">
            <Segmented
              value={settings.display.timeInputZone}
              onChange={(v) => setSettings((s) => ({ ...s, display: { ...s.display, timeInputZone: v } }))}
              options={[
                { value: 'NY', label: 'Najpierw Nowy Jork' },
                { value: 'WAW', label: 'Najpierw Warszawa' }
              ]}
            />
          </Field>
          <Field label="Próg BE (R)" hint="wynik w granicach ±próg = break-even: nie liczy się do win rate">
            <NumberField
              className="w-[90px]"
              value={settings.stats.breakevenThresholdR}
              onChange={(v) => v != null && v >= 0 && setSettings((s) => ({ ...s, stats: { ...s.stats, breakevenThresholdR: v } }))}
              decimals={2}
              step={0.05}
            />
          </Field>
        </div>
      </Panel>
      <Panel title="Ryzyko">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Field label="Waluta konta">
            <TextField
              mono
              className="w-[80px]"
              value={settings.risk.accountCurrency}
              onChange={(v) => {
                const c = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
                if (c.length === 3) setSettings((s) => ({ ...s, risk: { ...s.risk, accountCurrency: c } }))
              }}
            />
          </Field>
          <Field label="Domyślne ryzyko %">
            <NumberField
              className="w-[90px]"
              value={settings.risk.defaultRiskPercent}
              onChange={(v) => v && v > 0 && setSettings((s) => ({ ...s, risk: { ...s.risk, defaultRiskPercent: v } }))}
              decimals={2}
              step={0.05}
            />
          </Field>
          <Field label="Wielkość lota">
            <NumberField
              className="w-[110px]"
              value={settings.risk.contractSize}
              onChange={(v) => v && v > 0 && setSettings((s) => ({ ...s, risk: { ...s.risk, contractSize: v } }))}
              decimals={0}
            />
          </Field>
          <Field label="Krok lota">
            <NumberField
              className="w-[90px]"
              value={settings.risk.lotStep}
              onChange={(v) => v && v > 0 && setSettings((s) => ({ ...s, risk: { ...s.risk, lotStep: v } }))}
            />
          </Field>
        </div>
      </Panel>
    </>
  )
}
