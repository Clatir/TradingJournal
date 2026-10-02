/**
 * Deterministic sample data (demo mode): ~6 weeks of trades, day plans, two week reviews and
 * library items, generated from a seed so analytics have something meaningful to show.
 * Kept strictly separate from real data – the app writes it to its own folder in userData.
 */
import { DateTime } from 'luxon'
import { createDayPlan, createDefaultJournal, createTrade } from '../defaults'
import { newId } from '../ids'
import { fromLocal, isoWeekOf } from '../calc/time'
import { SCHEMA_VERSION, type BiasDirection, type DayPlan, type JournalFile, type LibraryItem, type Trade, type WeekReview } from '../schema'
import { libraryItemSchema } from '../schema/library'
import { weekReviewSchema, WEEKDAYS } from '../schema/week'

export interface ScreenSpec {
  target: 'trade' | 'day' | 'library'
  targetId: string
  /** Day plan pair section, when target = day. */
  pair: string
  phase: 'before' | 'during' | 'after' | null
  timeframe: string
  direction: 'long' | 'short'
  entry: number
  stop: number
  target1: number
  /** Price where the trade ended (for the "after" chart). */
  exit: number | null
  seed: number
  label: string
}

export interface SampleData {
  journal: JournalFile
  trades: Trade[]
  days: DayPlan[]
  weeks: WeekReview[]
  library: LibraryItem[]
  screens: ScreenSpec[]
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PAIRS: Array<{ pair: string; weight: number; price: number; decimals: number }> = [
  { pair: 'EURUSD', weight: 0.55, price: 1.0865, decimals: 5 },
  { pair: 'AUDUSD', weight: 0.15, price: 0.6612, decimals: 5 },
  { pair: 'EURGBP', weight: 0.1, price: 0.8534, decimals: 5 },
  { pair: 'USDCHF', weight: 0.1, price: 0.8821, decimals: 5 },
  { pair: 'EURAUD', weight: 0.1, price: 1.6418, decimals: 5 }
]

const NOTES_WIN = [
  'Sweep Asia low w London, MSS na M5 z displacement, wejście w FVG. Cena dowiozła do PDH.',
  'NY open: zebranie PDL, breaker na M15, czysty ruch do celu. Trzymałem plan.',
  'OTE 62–79% po MSS, wejście limitem. TP1 zdjęty, reszta na BE.',
  'Silver Bullet 10–11: FVG po sweepie EQL, szybkie dowiezienie do TP.'
]
const NOTES_LOSS = [
  'Wejście przed potwierdzeniem MSS – cena wróciła i zebrała mój SL.',
  'Setup poprawny, ale dane z USA wybiły SL przed ruchem w moją stronę.',
  'Za ciasny SL pod oczywistym EQL – zebrany, potem poszło w moją stronę.',
  'Wejście poza killzone, bez displacementu. Niepotrzebny trade.'
]
const NOTES_BE = ['Przesunąłem SL na BE po TP1 – zebrane, potem dowiozło bez mnie.', 'Brak follow-through po MSS, zamknięte na BE.']
const NEWS = [
  ['USD', 'CPI'],
  ['USD', 'NFP'],
  ['USD', 'FOMC'],
  ['EUR', 'ECB decyzja'],
  ['USD', 'PPI'],
  ['EUR', 'CPI flash']
] as const

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)] as T
}

function weighted<T extends { weight: number }>(rnd: () => number, xs: readonly T[]): T {
  let x = rnd()
  for (const item of xs) {
    x -= item.weight
    if (x <= 0) return item
  }
  return xs[xs.length - 1] as T
}

function round(v: number, d: number): number {
  return Number(v.toFixed(d))
}

/** Trading days (Mon–Fri) ending with `endDate`, oldest first. */
function tradingDays(endDate: string, count: number): string[] {
  const out: string[] = []
  let d = DateTime.fromISO(endDate, { zone: 'utc' })
  while (out.length < count) {
    if (d.weekday <= 5) out.unshift(d.toISODate() as string)
    d = d.minus({ days: 1 })
  }
  return out
}

export function generateSample(opts: { seed?: number; endDate: string; now?: string; tradeCount?: number }): SampleData {
  const rnd = mulberry32(opts.seed ?? 1234)
  const now = opts.now ?? new Date().toISOString()
  const journal = createDefaultJournal(now)
  journal.settings.risk.accountBalance = 10000
  journal.settings.risk.conversionRates = { AUD: 0.66, GBP: 1.27, CHF: 1.13 }
  const d = journal.dictionaries
  const id = (list: { id: string; name: string }[], name: string) => list.find((x) => x.name === name)?.id ?? null
  const tag = {
    movedTp: id(d.mistakeTags, 'Przesunięty TP'),
    tightSl: id(d.mistakeTags, 'SL za ciasny'),
    outsideKz: id(d.mistakeTags, 'Wejście poza killzone')
  }

  const days = tradingDays(opts.endDate, 30)
  const tradeCount = opts.tradeCount ?? 30
  const missedTarget = 3
  const trades: Trade[] = []
  const plans = new Map<string, DayPlan>()
  const screens: ScreenSpec[] = []
  const prices = new Map(PAIRS.map((p) => [p.pair, p.price]))

  // Daily bias per pair, persistent for a few days (trend), occasionally flipping.
  const bias = new Map<string, BiasDirection>(PAIRS.map((p) => [p.pair, rnd() < 0.5 ? 'bullish' : 'bearish']))

  const plan = (date: string): DayPlan => {
    let p = plans.get(date)
    if (!p) {
      p = createDayPlan(date, ['EURUSD'], journal.settings.contextInstruments, now)
      p.createdAt = p.updatedAt = `${date}T05:30:00.000Z`
      plans.set(date, p)
    }
    return p
  }

  const ensureSection = (p: DayPlan, pair: string) => {
    let s = p.pairs.find((x) => x.pair === pair)
    if (!s) {
      s = { pair, bias: { W: { direction: null, reason: '' }, D: { direction: null, reason: '' }, H4: { direction: null, reason: '' }, H1: { direction: null, reason: '' } }, drawOnLiquidity: '', keyLevels: [], scenarioPrimary: '', scenarioAlternative: '', screens: [] }
      p.pairs.push(s)
    }
    const dir = bias.get(pair) ?? 'bullish'
    const up = dir === 'bullish'
    const price = prices.get(pair) ?? 1
    s.bias.W = { direction: dir, reason: up ? 'Tygodniowy displacement w górę, cel PWH' : 'Odrzucenie premium tygodnia, cel PWL' }
    s.bias.D = { direction: dir, reason: up ? 'Zamknięcie nad PDH, discount FVG poniżej' : 'Zamknięcie pod PDL, premium OB powyżej' }
    s.bias.H4 = { direction: rnd() < 0.8 ? dir : 'neutral', reason: up ? 'MSS w górę, FVG H4 trzymane' : 'Seria niższych szczytów' }
    s.bias.H1 = { direction: rnd() < 0.7 ? dir : 'neutral', reason: '' }
    s.drawOnLiquidity = up ? `PDH ${price + 0.0035} / EQH nad Azją` : `PDL ${price - 0.0035} / EQL pod Azją`
    s.keyLevels = [
      { id: newId(), price: round(price + 0.0035, 5), label: 'PDH' },
      { id: newId(), price: round(price - 0.0035, 5), label: 'PDL' },
      { id: newId(), price: round(price + (up ? -0.0015 : 0.0015), 5), label: up ? 'H4 FVG (discount)' : 'H4 OB (premium)' }
    ]
    s.scenarioPrimary = up ? 'London zbiera Asia low → MSS M15 → long z FVG do PDH.' : 'London zbiera Asia high → MSS M15 → short z FVG do PDL.'
    s.scenarioAlternative = up ? 'Zamknięcie H1 pod PDL unieważnia – czekam na NY.' : 'Zamknięcie H1 nad PDH unieważnia – czekam na NY.'
  }

  for (const date of days) {
    // drift prices and occasionally flip bias
    for (const p of PAIRS) {
      prices.set(p.pair, round((prices.get(p.pair) ?? p.price) * (1 + (rnd() - 0.5) * 0.006), 5))
      if (rnd() < 0.12) bias.set(p.pair, bias.get(p.pair) === 'bullish' ? 'bearish' : 'bullish')
    }
    const p = plan(date)
    ensureSection(p, 'EURUSD')
    for (const im of p.intermarket) {
      im.relation = rnd() < 0.65 ? 'confirms' : rnd() < 0.5 ? 'diverges' : 'neutral'
      im.read = im.relation === 'diverges' ? 'SMT – nie potwierdza ruchu' : im.relation === 'confirms' ? 'potwierdza' : ''
    }
    if (rnd() < 0.25) {
      const [currency, title] = pick(rnd, NEWS)
      const t = fromLocal(date, currency === 'USD' ? '08:30' : '07:45', 'NY')
      if (t) p.news.push({ id: newId(), time: t.iso, currency, title, impact: 'high' })
    }
    p.review = {
      whatHappened: rnd() < 0.6 ? 'Scenariusz główny zrealizowany w London, NY kontynuacja.' : 'Cena zrobiła Judas swing i odwróciła się w NY.',
      vsPlan: rnd() < 0.55 ? 'matched' : rnd() < 0.6 ? 'partial' : 'missed',
      notes: ''
    }
  }

  // Spread trades across days (some days none, some two).
  const slots: string[] = []
  while (slots.length < tradeCount) {
    const date = pick(rnd, days)
    if (slots.filter((x) => x === date).length < 2) slots.push(date)
  }
  slots.sort()

  slots.forEach((date, i) => {
    const pairInfo = weighted(rnd, PAIRS)
    const pair = pairInfo.pair
    const p = plan(date)
    ensureSection(p, pair)
    const section = p.pairs.find((x) => x.pair === pair)!
    const dayBias = section.bias.D.direction
    const counter = rnd() < 0.15
    const direction: Trade['direction'] = (dayBias === 'bullish') !== counter ? 'long' : 'short'
    const sign = direction === 'long' ? 1 : -1

    const sessionRoll = rnd()
    const [h0, h1] = sessionRoll < 0.55 ? [2.2, 4.8] : sessionRoll < 0.9 ? [7.2, 9.8] : [11.4, 13]
    const hour = h0 + rnd() * (h1 - h0)
    const hh = String(Math.floor(hour)).padStart(2, '0')
    const mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0')
    const entryTime = fromLocal(date, `${hh}:${mm}`, 'NY')!.iso

    const pip = 0.0001
    const slPips = rnd() < 0.15 ? 21 + Math.round(rnd() * 7) : 8 + Math.round(rnd() * 10)
    const rr1 = rnd() < 0.15 ? 1.5 : 2 + Math.round(rnd() * 2) * 0.5
    const entry = round(prices.get(pair)! + (rnd() - 0.5) * 0.002, 5)
    const stop = round(entry - sign * slPips * pip, 5)
    const tp1 = round(entry + sign * slPips * rr1 * pip, 5)
    const tp2 = round(entry + sign * slPips * 4 * pip, 5)

    const outside = sessionRoll >= 0.9
    const ruleBreak = counter || outside || slPips > 20 || rr1 < 2
    const roll = rnd()
    const [pWin, pBe] = ruleBreak ? [0.2, 0.12] : [0.4, 0.15]
    const missed = i % Math.floor(tradeCount / missedTarget) === 3 && trades.filter((t) => t.status === 'missed').length < missedTarget

    const exitTime = DateTime.fromISO(entryTime).plus({ minutes: 30 + Math.round(rnd() * 210) }).toUTC().toISO()!
    let exits: Trade['exits'] = []
    let notes = ''
    let mistakes: string[] = []
    let mae = 0
    let mfe = 0
    if (roll < pWin) {
      const split = rnd() < 0.4
      exits = split
        ? [
            { id: newId(), time: exitTime, price: tp1, percent: 50, note: 'TP1' },
            { id: newId(), time: DateTime.fromISO(exitTime).plus({ minutes: 45 }).toUTC().toISO()!, price: tp2, percent: 50, note: 'TP2' }
          ]
        : [{ id: newId(), time: exitTime, price: tp1, percent: 100, note: 'TP1' }]
      notes = pick(rnd, NOTES_WIN)
      mae = round(slPips * rnd() * 0.6, 1)
      mfe = round(slPips * (split ? 4.2 : rr1 + rnd()), 1)
      if (rnd() < 0.12 && tag.movedTp) mistakes = [tag.movedTp]
    } else if (roll < pWin + pBe) {
      exits = [{ id: newId(), time: exitTime, price: entry, percent: 100, note: 'BE' }]
      notes = pick(rnd, NOTES_BE)
      mae = round(slPips * rnd() * 0.7, 1)
      mfe = round(slPips * (1 + rnd()), 1)
      if (rnd() < 0.5 && tag.movedTp) mistakes = [tag.movedTp]
    } else {
      exits = [{ id: newId(), time: exitTime, price: stop, percent: 100, note: 'SL' }]
      notes = pick(rnd, NOTES_LOSS)
      mae = slPips
      mfe = round(slPips * rnd() * 0.8, 1)
      if (outside && tag.outsideKz) mistakes.push(tag.outsideKz)
      if (slPips < 12 && rnd() < 0.6 && tag.tightSl) mistakes.push(tag.tightSl)
    }

    const trade = createTrade(
      {
        pair,
        direction,
        entryTime,
        status: missed ? 'missed' : 'closed',
        entryModelId: pick(rnd, d.entryModels).id,
        entryPdArrayId: pick(rnd, d.pdArrays.slice(0, 4)).id,
        htfPdArrayId: pick(rnd, d.pdArrays.slice(0, 3)).id,
        liquidityTakenIds: [pick(rnd, d.liquidityPools).id],
        prices: { entry, stopLoss: stop, takeProfit1: tp1, takeProfit2: tp2 },
        exits: missed ? [] : exits,
        maePips: missed ? null : mae,
        mfePips: missed ? null : mfe,
        riskPercent: 0.5,
        riskAmount: 50,
        lots: round(50 / (slPips * 10), 2),
        stopBeyondLiquidity: rnd() < 0.8 ? 'yes' : rnd() < 0.5 ? 'no' : 'unknown',
        psychology: {
          before: { score: 3 + Math.floor(rnd() * 3), note: rnd() < 0.3 ? 'spokojny, plan gotowy' : '' },
          during: { score: 2 + Math.floor(rnd() * 4), note: '' },
          after: { score: 2 + Math.floor(rnd() * 4), note: '' },
          mistakeTagIds: missed ? [] : mistakes,
          didWell: rnd() < 0.5 ? 'Czekałem na killzone i potwierdzenie MSS.' : '',
          nextTime: mistakes.length ? 'Nie ruszać TP/SL po wejściu – plan jest planem.' : ''
        },
        missed: missed ? { reasonId: pick(rnd, d.missedReasons).id, hypotheticalOutcome: rnd() < 0.6 ? 'tp1' : rnd() < 0.5 ? 'sl' : 'tp2' } : { reasonId: null, hypotheticalOutcome: null },
        notes: missed ? 'Widziałem setup, ale nie wszedłem.' : notes
      },
      `${date}T12:00:00.000Z`
    )
    trade.updatedAt = trade.createdAt
    trades.push(trade)

    if (!missed && i % 2 === 0) {
      const last = exits[exits.length - 1]?.price ?? null
      const base = { target: 'trade' as const, targetId: trade.id, pair, direction, entry, stop, target1: tp1, seed: Math.floor(rnd() * 1e9) }
      screens.push({ ...base, phase: 'before', timeframe: 'H1', exit: null, label: 'przed' })
      screens.push({ ...base, phase: 'after', timeframe: 'M5', exit: last, label: 'po', seed: base.seed + 1 })
    }
  })

  // Day-plan screens for the last few plans.
  for (const p of [...plans.values()].slice(-4)) {
    const s = p.pairs[0]!
    const price = s.keyLevels[0]?.price ?? 1.08
    screens.push({
      target: 'day',
      targetId: p.id,
      pair: s.pair,
      phase: null,
      timeframe: 'H4',
      direction: s.bias.D.direction === 'bearish' ? 'short' : 'long',
      entry: price - 0.002,
      stop: price - 0.004,
      target1: price,
      exit: null,
      seed: Math.floor(rnd() * 1e9),
      label: `plan-${s.pair}`
    })
  }

  // Two most recent complete ISO weeks.
  const weeks: WeekReview[] = []
  const weekIds = [...new Set(days.map((x) => isoWeekOf(x)))].slice(-3, -1)
  for (const week of weekIds) {
    const hi = Math.floor(rnd() * 5)
    const lo = (hi + 1 + Math.floor(rnd() * 4)) % 5
    const times = ['02:45', '03:30', '04:15', '08:30', '09:45', '10:30', '14:15']
    weeks.push(
      weekReviewSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id: newId(),
        createdAt: now,
        updatedAt: now,
        week,
        pairs: [
          {
            pair: 'EURUSD',
            days: WEEKDAYS.map((day) => ({ day, high: null, low: null, highTimeNy: pick(rnd, times), lowTimeNy: pick(rnd, times) })),
            weekHighDay: WEEKDAYS[hi],
            weekLowDay: WEEKDAYS[lo],
            source: 'manual',
            notes: ''
          }
        ],
        conclusions: 'High/low dnia najczęściej w London (02–05 NY). Wtorek/środa robiły ekstremum tygodnia.',
        goalNextWeek: 'Wchodzić tylko po MSS z displacementem w killzone.',
        previousGoalResult: rnd() < 0.5 ? 'yes' : 'partial'
      })
    )
  }

  // Library: annotated examples, two linked to winning trades.
  const winners = trades.filter((t) => t.status === 'closed' && t.exits[0]?.note?.startsWith('TP')).slice(0, 2)
  const library: LibraryItem[] = []
  const libraryDefs: Array<{ title: string; type: 'live' | 'backtest'; trade?: Trade }> = [
    { title: 'London sweep Asia low → MSS → FVG', type: 'live', trade: winners[0] },
    { title: 'NY Silver Bullet po sweepie EQL', type: 'live', trade: winners[1] },
    { title: 'Turtle soup na PDH (backtest)', type: 'backtest' },
    { title: 'Breaker po Judas swing (backtest)', type: 'backtest' }
  ]
  for (const def of libraryDefs) {
    const t = def.trade
    const item = libraryItemSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: newId(),
      createdAt: now,
      updatedAt: now,
      title: def.title,
      type: def.type,
      pair: t?.pair ?? 'EURUSD',
      direction: t?.direction ?? (rnd() < 0.5 ? 'long' : 'short'),
      date: t ? t.entryTime.slice(0, 10) : days[Math.floor(rnd() * days.length)],
      entryModelId: t?.entryModelId ?? pick(rnd, d.entryModels).id,
      killzoneId: journal.settings.killzones[rnd() < 0.6 ? 0 : 1]!.id,
      pdArrayIds: [pick(rnd, d.pdArrays.slice(0, 4)).id],
      notes: 'Kluczowe: displacement po zebraniu płynności i powrót do FVG w killzone.',
      linkedTradeId: t?.id ?? null
    })
    library.push(item)
    const price = t?.prices.entry ?? 1.085
    const dir = item.direction ?? 'long'
    const sign = dir === 'long' ? 1 : -1
    screens.push({
      target: 'library',
      targetId: item.id,
      pair: item.pair ?? 'EURUSD',
      phase: null,
      timeframe: 'M15',
      direction: dir,
      entry: price,
      stop: round(price - sign * 0.0012, 5),
      target1: round(price + sign * 0.003, 5),
      exit: round(price + sign * 0.003, 5),
      seed: Math.floor(rnd() * 1e9),
      label: 'setup'
    })
  }

  return { journal, trades, days: [...plans.values()], weeks, library, screens }
}
