// Reference model of the payout forecast ("Prognoza wypłat") and generator of the test fixture.
//
//   node scripts/forecast-vectors.mjs      -> writes tests/fixtures/forecast-vectors.json and prints OK
//
// simulate() is the executable form of chapter 5 of the specification. The scenarios below are the
// test cases; the checksum proves that the numbers in this file were saved without a typo and that
// Node computes exactly the values that were verified against the HTML prototype (T1-T10).
// Options: --no-check writes the file even when the checksum differs (only after changing scenarios on purpose).
// All money is a plain number (IEEE double), exactly like the prototype and the rest of the app.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_SHA256 = 'c1f17425a605719542b05e1baeeb1610994b8765314fc57745deb799c5a1bc95'
const MAX_MONTHS = 240

const cents = (x) => Math.floor(x * 100 + 0.5)
/** Round down to a multiple of step (float noise tolerant), like calc/position.ts. */
const floorToStep = (value, step) => Math.floor(value / step + 1e-9) * step
/** Uniform number for month index i. The app always stores enough draws; a missing one counts as `missing`. */
const draw = (arr, i, missing = 0) => (arr && i < arr.length ? arr[i] : missing)
const sum = (arr) => arr.reduce((s, a) => s + a, 0)
const ordered = (a, b) => [Math.min(a, b), Math.max(a, b)]

/**
 * sc: { keep 'cash'|'fund', payout (percent), start, monthly, horizon, m0 (0-11), y0,
 *       deposits {month: amount}, goals [{name, month, amount|null, on, flex}],
 *       gain 'pct'|'pips', pct {mode, fixed, lo, hi},
 *       pips {pipsMode, pips, pipsLo, pipsHi, lotMode, lot, lotPer, lotPerAmount, riskPct, slPips, lotMax, pipValueMinLot, minLot},
 *       loss {prob, pctLo, pctHi, pipsLo, pipsHi}, tax {on, rate, payMonth 1-12},
 *       draws {rate[], loss[], lossSize[], pips[]} }   (missing keys = feature off)
 */
function simulate(sc) {
  const N = sc.horizon
  const p = sc.payout / 100
  const invest = sc.keep === 'fund'
  const deps = new Map(Object.entries(sc.deposits ?? {}).map(([k, v]) => [Number(k), v]))
  const loss = sc.loss ?? { prob: 0 }
  const tax = sc.tax ?? { on: false }
  const dr = sc.draws ?? {}
  const queue = (sc.goals ?? [])
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => (g.on ?? true) && Number.isInteger(g.month) && g.month >= 1 && g.month <= MAX_MONTHS && g.month <= N)
    .sort((a, b) => a.g.month - b.g.month || a.i - b.i) // by month, then by position on the list
    .map(({ g }) => g)
  const bought = new Set()
  const res = {}
  let B = 0
  let P = 0
  const tot = { payout: 0, profit: 0, spent: 0, paidIn: sc.start, withdrawn: 0, taxPaid: 0, lossMonths: 0 }
  let rateSum = 0
  let pendingTax = [] // tax of closed years, not yet due
  let taxDue = 0
  let yearProfit = 0
  const rows = []
  for (let k = 1; k <= N; k++) {
    const idx = sc.m0 + k - 1
    const cm = (idx % 12) + 1
    const cy = sc.y0 + Math.floor(idx / 12)
    // 1. deposit (a negative one is a withdrawal, at most what is there)
    const base = k === 1 ? sc.start : B
    let dep = deps.has(k) ? deps.get(k) : k === 1 ? 0 : sc.monthly
    if (dep < 0) {
      dep = -Math.min(-dep, Math.max(base, 0))
      tot.withdrawn += -dep
    } else tot.paidIn += dep
    const avail = base + dep
    // 2. tax of earlier years
    let taxMonth = 0
    if (tax.on) {
      if (cm === tax.payMonth) {
        taxDue += sum(pendingTax)
        pendingTax = []
      }
      if (taxDue > 0) {
        taxMonth = Math.min(taxDue, Math.max(avail, 0))
        taxDue -= taxMonth
        tot.taxPaid += taxMonth
      }
    }
    const Bs = avail - taxMonth
    // 3. the fund cannot be larger than the mass it sits in
    if (invest) P = Math.min(P, Math.max(Bs, 0))
    // 4. profit
    const isLoss = (loss.prob ?? 0) > 0 && draw(dr.loss, k - 1, 1) < loss.prob / 100
    let lot = null
    let pips = null
    let r
    let G
    if ((sc.gain ?? 'pct') === 'pct') {
      const c = sc.pct
      if (isLoss) {
        const [lo, hi] = ordered(loss.pctLo, loss.pctHi)
        r = -(lo + draw(dr.lossSize, k - 1) * (hi - lo)) / 100
      } else if (c.mode === 'fixed') r = c.fixed / 100
      else {
        const [lo, hi] = ordered(c.lo, c.hi)
        r = (lo + draw(dr.rate, k - 1) * (hi - lo)) / 100
      }
      G = Bs * r
    } else {
      const c = sc.pips
      const minLot = c.minLot
      const pv = c.pipValueMinLot
      if (isLoss) {
        const [lo, hi] = ordered(loss.pipsLo, loss.pipsHi)
        pips = -(lo + draw(dr.lossSize, k - 1) * (hi - lo))
      } else if ((c.pipsMode ?? 'fixed') === 'fixed') pips = c.pips
      else {
        const [lo, hi] = ordered(c.pipsLo, c.pipsHi)
        pips = lo + draw(dr.pips, k - 1) * (hi - lo)
      }
      const mode = c.lotMode ?? 'fixed'
      if (mode === 'fixed') lot = c.lot
      else if (mode === 'perCapital') lot = floorToStep(Math.floor(Math.max(Bs, 0) / c.lotPerAmount + 1e-9) * c.lotPer, minLot)
      else lot = floorToStep(((Math.max(Bs, 0) * c.riskPct) / 100) / ((c.slPips * pv) / minLot), minLot) // risk % and stop in pips
      if (mode !== 'fixed' && c.lotMax != null) lot = Math.min(lot, c.lotMax)
      const units = Math.round((lot / minLot) * 1e6) / 1e6
      G = Math.max(pips * pv * units, -Bs) // cannot lose more than there is
      r = Bs > 0 ? G / Bs : 0
    }
    if (isLoss) tot.lossMonths++
    // 5.-6. payout and booking
    const J = G > 0 ? G * p : 0
    if (invest) {
      B = Bs + G
      P = Math.min(P + J, Math.max(B, 0))
    } else {
      B = Bs + G - J
      P = P + J
    }
    tot.payout += J
    tot.profit += G
    rateSum += r
    // 7. goals, in queue order
    const buys = []
    for (const g of queue) {
      if (bought.has(g)) continue
      if (k < g.month) break
      const hasAmount = g.amount != null && g.amount > 0
      let take
      if (hasAmount) {
        if (cents(P) < cents(g.amount)) {
          if (g.flex) continue // may wait: does not block the next goals
          break
        }
        take = g.amount
      } else take = Math.max(P, 0) // no amount: takes everything set aside
      P = Math.max(0, P - take)
      if (invest) B = Math.max(0, B - take)
      res[g.name] = {
        month: k,
        planned: g.month,
        amount: take,
        whole: !hasAmount,
        empty: !hasAmount && cents(take) <= 0,
        after: buys.length ? buys[buys.length - 1].name : null // goal bought just before it in the same month
      }
      tot.spent += take
      bought.add(g)
      buys.push({ name: g.name, amount: take })
    }
    // 9. close the tax year after December or after the last row
    if (tax.on) {
      yearProfit += G
      if (cm === 12 || k === N) {
        pendingTax.push((tax.rate / 100) * Math.max(0, yearProfit))
        yearProfit = 0
      }
    }
    const head = queue.find((g) => !bought.has(g))?.name ?? null // first goal still waiting (label "na: ...")
    rows.push({ k, month: cm, year: cy, rate: r, dep, tax: taxMonth, start: Bs, profit: G, payout: J, pot: P, buys, end: B, lot, pips, loss: isLoss, head })
  }
  let blocker = null
  for (const g of queue) {
    if (bought.has(g)) continue
    res[g.name] = blocker != null ? { blockedBy: blocker } : { pending: true, have: P }
    if (blocker == null && !g.flex) blocker = g.name
  }
  return {
    rows,
    res,
    tot: { ...tot, pot: P, end: B, meanRate: rateSum / N, lastPayout: rows[N - 1].payout, taxOutstanding: taxDue + sum(pendingTax) }
  }
}

// ---------------------------------------------------------------- scenarios

const frac = (x) => x - Math.floor(x)
const seq = (c) => Array.from({ length: MAX_MONTHS }, (_, k) => frac((k + 1) * c))
/** Deterministic "random" numbers for the E tests. */
const DRAWS = { rate: seq(0.6180339887), loss: seq(0.4142135624), lossSize: seq(0.7320508076), pips: seq(0.2360679775) }
const fill = (v) => Array.from({ length: 50 }, () => v)
/** 0.99 everywhere (no loss), except the listed months. */
const lossDraws = (special) => Array.from({ length: 50 }, (_, i) => special[i + 1] ?? 0.99)
const G = (...a) => a.map(([month, amount, flex], i) => ({ name: `Cel ${i + 1}`, month, amount, on: true, flex }))
const goal = (name, month, amount, on = true) => ({ name, month, amount, on, flex: false })

const PCT = { mode: 'fixed', fixed: 11, lo: 7, hi: 10 }
const PIP_VALUE = 0.1 * 3.8881 // 0.10 USD for 0.01 lot, at 3.8881 PLN per USD
// T1-T10: what the HTML prototype shows (goals without amounts in months 6, 12, 19).
const protoGoals = (first = null) => [
  { name: 'Cel 1', month: 6, amount: first },
  { name: 'Cel 2', month: 12, amount: null },
  { name: 'Cel 3', month: 19, amount: null }
]
const PB = { start: 10000, monthly: 2000, horizon: 50, m0: 10, y0: 2026, deposits: {}, goals: protoGoals() }
const PP = { ...PB, gain: 'pct', pct: PCT, payout: 10, keep: 'cash' }
const PIPS_PROTO = { pipsMode: 'fixed', pips: 200, lotMode: 'fixed', lot: 0.1, pipValueMinLot: PIP_VALUE, minLot: 0.01 }
const T10_RATE = [
  0.8092203239710412, 0.808384893636823, 0.25664775019296326, 0.4068794746488934, 0.8518956746030467,
  0.5196601971301652, 0.5705307767271993, 0.6401276370660102, 0.36993197299918845, 0.4316533576284932,
  0.7214330086793063, 0.24841524152774352, 0.4026257233014243, 0.3487079665726708, 0.9536560819914043,
  0.6865977782627863, 0.694927639426284, 0.5004774260326822, 0.39110304244630556, 0.6287933612209899,
  0.5276641784966768, 0.6498239648712406, 0.5168339212033964, 0.40780047243521333, 0.7677286062640107,
  0.8802076015474739, 0.9743990617459505, 0.8435712694240957, 0.17715817352414975, 0.08232785431858514,
  0.9136958529337103, 0.37843178460115556, 0.055123999622880504, 0.8012632107565024, 0.6266364374704197,
  0.003497302081451159, 0.6755478880753207, 0.8385311845599319, 0.9011119213973133, 0.010177850076981132,
  0.1451755912226701, 0.832939397439463, 0.9984214913327243, 0.40193862722849816, 0.8854854554777609,
  0.6625414111183353, 0.5235879736367861, 0.6782930044843217, 0.34749384582875353, 0.9335824355067348
]
const PROTO = {
  T1: PP,
  T2: { ...PP, keep: 'fund' },
  T3: { ...PP, goals: protoGoals(2000), keep: 'fund' },
  T4: { ...PP, goals: protoGoals(2000) },
  T5: { ...PP, deposits: { 1: 1000, 3: 5000, 5: 0 } },
  T6: { ...PP, deposits: { 1: 1000, 3: 5000, 5: 0 }, keep: 'fund' },
  T7: { ...PB, gain: 'pips', pips: PIPS_PROTO, payout: 10, keep: 'cash' },
  T8: { ...PB, gain: 'pips', pips: PIPS_PROTO, payout: 10, keep: 'fund' },
  T9: { ...PB, gain: 'pips', pips: PIPS_PROTO, payout: 50, keep: 'fund' },
  T10: { ...PP, pct: { ...PCT, mode: 'random' }, payout: 50, keep: 'fund', draws: { rate: T10_RATE } }
}

// E1-E20: improvements and edge cases.
const BASE = { ...PB, goals: G([6, null, false], [12, null, false], [19, null, false]), gain: 'pct', pct: PCT, payout: 10, keep: 'cash' }
const PIPS = { pipsMode: 'fixed', pips: 200, pipsLo: 100, pipsHi: 300, lotMode: 'fixed', lot: 0.1, lotPer: 0.01, lotPerAmount: 1000, riskPct: 1, slPips: 20, lotMax: null, pipValueMinLot: PIP_VALUE, minLot: 0.01 }
const LOSS = { prob: 25, pctLo: 2, pctHi: 5, pipsLo: 50, pipsHi: 150 }
const TAX = { on: true, rate: 19, payMonth: 4 }
const EXT = {
  E1: ['Podatek roczny 19%, płatny w kwietniu; gotówka', { ...BASE, tax: TAX }],
  E2: ['Podatek roczny 19%, płatny w kwietniu; fundusz celowy', { ...BASE, keep: 'fund', tax: TAX }],
  E3: ['Cel 1 (5000) „może poczekać”, Cel 2 (1500), Cel 3 (3000); gotówka', { ...BASE, goals: G([6, 5000, true], [12, 1500, false], [19, 3000, false]) }],
  E4: ['Jak E3, ale Cel 1 bez „może poczekać”: blokuje kolejne', { ...BASE, goals: G([6, 5000, false], [12, 1500, false], [19, 3000, false]) }],
  E5: ['Wypłaty z kapitału: miesiąc 8 = -10000, miesiąc 20 = -999999999 (więcej niż jest); fundusz', { ...BASE, keep: 'fund', deposits: { 8: -10000, 20: -999999999 } }],
  E6: ['Pipsy 200, lot na kwotę kapitału: 0.01 lota na każde 1000; gotówka', { ...BASE, gain: 'pips', pips: { ...PIPS, lotMode: 'perCapital' } }],
  E7: ['Pipsy 200, lot z ryzyka 1% i SL 20 pipsów, maks. 5 lotów; fundusz', { ...BASE, keep: 'fund', gain: 'pips', pips: { ...PIPS, lotMode: 'risk', lotMax: 5 } }],
  E8: ['Zwrot losowy 7-10% i miesiące stratne: 25% szans, strata 2-5%; fundusz; wypłata 50%', { ...BASE, keep: 'fund', payout: 50, pct: { ...PCT, mode: 'random' }, loss: LOSS, draws: DRAWS }],
  E9: [
    'Pipsy losowe 100-300, miesiące stratne 25% (50-150 pipsów), lot z ryzyka; granice zakresów wpisane odwrotnie (300-100, 150-50); gotówka',
    { ...BASE, gain: 'pips', pips: { ...PIPS, pipsMode: 'random', lotMode: 'risk', pipsLo: 300, pipsHi: 100 }, loss: { ...LOSS, pipsLo: 150, pipsHi: 50 }, draws: DRAWS }
  ],
  E10: [
    'Wszystko naraz: fundusz, podatek, cel z „może poczekać”, wypłata z kapitału, straty, zwrot losowy 7-10% (wpisany odwrotnie: 10-7)',
    {
      ...BASE, keep: 'fund', payout: 40, pct: { mode: 'random', fixed: 11, lo: 10, hi: 7 }, loss: LOSS, draws: DRAWS, tax: TAX,
      deposits: { 10: -5000, 15: 6000 }, goals: G([6, 8000, true], [12, 2500, false], [30, null, false])
    }
  ],
  E11: ['Cel 1 (50 000 000, bez „może poczekać”) nie uzbiera się: czeka do końca i blokuje Cel 2 i Cel 3; gotówka', { ...BASE, goals: G([6, 50000000, false], [12, null, false], [19, 3000, false]) }],
  E12: ['Cel 1 (50 000 000, „może poczekać”) i Cel 2 (60 000 000) nie uzbierają się; Cel 3 czeka na Cel 2; fundusz', { ...BASE, keep: 'fund', goals: G([6, 50000000, true], [12, 60000000, false], [19, null, false]) }],
  E13: [
    'Dwa cele bez kwoty w tym samym miesiącu (drugi nic nie dostaje), cel wyłączony, cel poza tabelą i cel bez miesiąca; gotówka',
    { ...BASE, goals: [goal('Cel 1', 6, null), goal('Cel 2', 6, null), goal('Cel 3', 12, null, false), goal('Cel 4', 60, null), goal('Cel 5', 19, null), goal('Cel 6', null, null)] }
  ],
  E14: ['Podatek, gdy tabela nie kończy się w grudniu: start 3-2027, 31 miesięcy (koniec 9-2029); gotówka', { ...BASE, m0: 2, y0: 2027, horizon: 31, tax: TAX }],
  E15: ['Podatek większy niż kapitał: w miesiącu 17 wypłata całego kapitału, podatek za 2027 spłacany ratami od miesiąca 18; gotówka', { ...BASE, tax: TAX, deposits: { 17: -999999999 } }],
  E16: [
    'Fundusz nie może być większy niż masa: start 1000 bez dopłat, wypłata 50%, wypłaty z kapitału w mies. 5 i 8, strata w mies. 6 (granice 20-10 wpisane odwrotnie); los = 0.5 przy szansie 50% (mies. 10) to nie strata',
    {
      ...BASE, keep: 'fund', payout: 50, start: 1000, monthly: 0, goals: [], pct: { ...PCT, fixed: 10 },
      loss: { prob: 50, pctLo: 20, pctHi: 10, pipsLo: 50, pipsHi: 150 }, deposits: { 5: -1220, 8: -100 },
      draws: { rate: fill(0), loss: lossDraws({ 6: 0, 10: 0.5 }), lossSize: fill(0.25), pips: fill(0) }
    }
  ],
  E17: [
    'Pipsy, stały lot 1.00 (maksymalny lot 0.5 nie dotyczy stałego lota), strata 1000 pipsów w mies. 3 większa niż kapitał; mies. 4 startuje od zera; gotówka',
    {
      ...BASE, start: 5000, monthly: 0, gain: 'pips', pips: { ...PIPS, lot: 1, lotMax: 0.5 },
      loss: { prob: 25, pctLo: 2, pctHi: 5, pipsLo: 1000, pipsHi: 1000 },
      draws: { rate: fill(0), loss: lossDraws({ 3: 0, 6: 0.25 }), lossSize: fill(0.5), pips: fill(0) }
    }
  ],
  E18: ['Porównanie w groszach: kapitał 10005, cel 110.06 w mies. 1; odłożone jest o ułamek grosza mniej, a cel i tak jest kupiony w mies. 1; gotówka', { ...BASE, start: 10005, goals: G([1, 110.06, false], [12, null, false]) }],
  E19: [
    'Cele wpisane nie po kolei: kolejka wg miesiąca, a w tym samym miesiącu wg kolejności na liście; gotówka',
    { ...BASE, goals: [goal('Cel 1', 19, null), goal('Cel 2', 6, 500), goal('Cel 3', 6, null), goal('Cel 4', 12, null)] }
  ],
  E20: [
    'Pipsy losowe z zakresu od -100 do 300 (wpisane odwrotnie), bez miesięcy stratnych: miesiąc z ujemnymi pipsami ma stratę, ale nie jest „miesiącem stratnym”; fundusz',
    { ...BASE, keep: 'fund', gain: 'pips', pips: { ...PIPS, pipsMode: 'random', pipsLo: 300, pipsHi: -100 }, draws: DRAWS }
  ]
}

// ---------------------------------------------------------------- fixture

const r2 = (x) => Number(x.toFixed(2))
const r4 = (x) => Number(x.toFixed(4))
const roundAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? r2(v) : v]))

function testCase(source, description, sc) {
  const sim = simulate(sc)
  const pipsMode = sc.gain === 'pips'
  const rows = sim.rows.map((a) => ({
    k: a.k,
    label: `${a.month}-${a.year}`,
    ratePct: r2(a.rate * 100),
    deposit: r2(a.dep),
    tax: r2(a.tax),
    start: r2(a.start),
    profit: r2(a.profit),
    payout: r2(a.payout),
    pot: r2(a.pot),
    buys: a.buys.map((b) => ({ name: b.name, amount: r2(b.amount) })),
    end: r2(a.end),
    loss: a.loss,
    head: a.head,
    ...(pipsMode ? { lot: r4(a.lot), pips: r4(a.pips) } : {})
  }))
  const { meanRate, ...tot } = sim.tot
  const totals = { ...roundAll(tot), meanRatePct: r2(meanRate * 100) }
  // "Zarobek funduszu": extra profit compared with the same scenario kept in cash
  if (sc.keep === 'fund') totals.fundGain = r2(sim.tot.profit - simulate({ ...sc, keep: 'cash' }).tot.profit)
  const scenario = JSON.parse(JSON.stringify(sc))
  if (scenario.draws) for (const key of Object.keys(scenario.draws)) scenario.draws[key] = scenario.draws[key].slice(0, sc.horizon)
  const goals = Object.fromEntries(Object.entries(sim.res).map(([name, g]) => [name, roundAll(g)]))
  return { source, ...(description ? { description } : {}), scenario, rows, goals, totals }
}

const ABOUT = [
  'Wartości wzorcowe prognozy wypłat. Plik generuje scripts/forecast-vectors.mjs (model referencyjny) - nie edytuj ręcznie.',
  'T1-T10: liczby pokazane przez prototyp HTML modułu. E1-E20: usprawnienia i przypadki brzegowe policzone modelem referencyjnym.',
  'Kwoty zaokrąglone do 2 miejsc (lot i pipsy do 4). Test porównuje wartość niezaokrągloną z wzorcem z tolerancją pół jednostki ostatniego miejsca: |x - wzorzec| <= 0.005 (lot, pipsy: 0.00005).',
  'scenario: brakujące klucze (także całe obiekty loss, tax, pct, draws) = wartości domyślne: goals[].on = true, goals[].flex = false, pct = {mode: fixed, fixed: 11, lo: 7, hi: 10}, loss = {prob: 0, pctLo: 2, pctHi: 5, pipsLo: 50, pipsHi: 150}, tax = {on: false, rate: 19, payMonth: 4}, pips: pipsMode = fixed, pipsLo = 100, pipsHi = 300, lotMode = fixed, lotPer = 0.01, lotPerAmount = 1000, riskPct = 1, slPips = 20, lotMax = null; draws = puste tablice. Klucze deposits to numery miesięcy zapisane tekstem.',
  'rows: label = etykieta miesiąca, ratePct = zwrot x 100, deposit = wpłata po ograniczeniu wypłaty z kapitału, tax = podatek zapłacony w miesiącu, buys = zakupy celów w miesiącu, loss = miesiąc stratny (flaga losowania, nie znak zysku), head = nazwa pierwszego celu, który jeszcze czeka (albo null).',
  'goals: wynik celu po nazwie. Kupiony: {month, planned, amount, whole, empty, after}; whole = cel bez kwoty, empty = cel bez kwoty, który nic nie dostał, after = nazwa celu kupionego tuż przed nim w tym samym miesiącu (albo null). Niekupiony do końca: {pending: true, have} albo {blockedBy: nazwa celu}. Cel wyłączony albo poza tabelą nie ma wpisu.',
  'totals: meanRatePct = średni zwrot x 100; fundGain (tylko keep=fund) = zysk łączny minus zysk łączny tego samego scenariusza z keep=cash (kafelek Zarobek funduszu).',
  'Brak liczby w draws.loss = miesiąc nie jest stratny; brak w pozostałych tablicach liczy się jako 0. (W wektorach braków nie ma.)',
  'pipValueMinLot = wartość pipsa najmniejszego lota w walucie scenariusza (0.10 USD x kurs 3.8881).',
  'pot = odłożona gotówka (keep=cash) albo fundusz celowy (keep=fund) na koniec miesiąca, po zakupach; start/end = kapitał albo masa obrotowa.'
]

const tests = {}
for (const [name, sc] of Object.entries(PROTO)) tests[name] = testCase('prototype', null, sc)
for (const [name, [description, sc]] of Object.entries(EXT)) tests[name] = testCase('reference', description, sc)

// One test per line keeps the file small and still diff-friendly.
const text = `{\n"_about": ${JSON.stringify(ABOUT, null, 1)},\n"tests": {\n${Object.entries(tests)
  .map(([name, t]) => `${JSON.stringify(name)}: ${JSON.stringify(t)}`)
  .join(',\n')}\n}\n}\n`

/** Capital / trading mass at the end of each test, to locate a typo when the checksum does not match. */
const END = {
  T1: 3365620.22, T2: 4665902.84, T3: 4668355.36, T4: 3365620.22, T5: 3602622.61, T6: 5001712.78, T7: 142992.9, T8: 145403.52, T9: 139493.61, T10: 1412550.8,
  E1: 2486230.69, E2: 3494247.98, E3: 3365620.22, E4: 3365620.22, E5: 441826.35, E6: 1091650.42, E7: 1264476.46, E8: 511289.09, E9: 685808.73, E10: 361162.83,
  E11: 3365620.22, E12: 5181190.57, E13: 3365620.22, E14: 460770.12, E15: 226250.36, E16: 9544.49, E17: 328933.26, E18: 3366181.08, E19: 3365620.22, E20: 126684.04
}

// The checksum covers the numbers (scenarios, rows, goals, totals), not the descriptions.
const data = Object.entries(tests).map(([name, { description, ...t }]) => [name, t])
const sha = createHash('sha256').update(JSON.stringify(data), 'utf8').digest('hex')
if (sha !== EXPECTED_SHA256 && !process.argv.includes('--no-check')) {
  const off = Object.keys(tests).filter((name) => tests[name].totals.end !== END[name])
  console.error(`CHECKSUM MISMATCH\n  expected ${EXPECTED_SHA256}\n  got      ${sha}`)
  console.error(off.length ? `  tests with a different end value: ${off.join(', ')}` : '  end values agree: the difference is in rows or scenario definitions')
  console.error('  This script differs from the specification (appendix C). Fix the script, not the checksum.')
  process.exit(1)
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'forecast-vectors.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, text, 'utf8')
console.log(`OK: ${Object.keys(tests).length} tests, ${text.length} characters, sha256 ${sha}\n-> ${out}`)
