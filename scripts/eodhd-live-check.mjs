#!/usr/bin/env node
/**
 * Scanner feasibility check during market hours (docs/skaner/rozpoznanie.md 4.1.1, 4.1.5, 4.1.7):
 *  1. stream: which symbols really tick (the snapshot right after subscribing does not count), ticks, spread;
 *  2. REST freshness: how far behind "now" the last 1m bar of EURUSD / XAUUSD is;
 *  3. bid or mid: M1 closes built from stream bid and mid vs REST 1m closes of the same minutes.
 *
 * Usage: EODHD_API_TOKEN=... node scripts/eodhd-live-check.mjs [minutes=10]
 * (Node ≥ 22; behind a proxy: NODE_USE_ENV_PROXY=1). The token is never printed.
 */
const TOKEN = process.env.EODHD_API_TOKEN
if (!TOKEN) {
  console.error('Brak EODHD_API_TOKEN w zmiennych środowiskowych.')
  process.exit(1)
}
const MINUTES = Number(process.argv[2]) || 10
const SYMBOLS = ['AUDUSD', 'EURAUD', 'EURGBP', 'EURUSD', 'USDCHF', 'XAUUSD', 'WTIUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'EURJPY', 'EURCHF', 'EURSEK', 'NZDUSD', 'USDPLN']
const PIP = (s) => (s === 'XAUUSD' ? 0.1 : s === 'WTIUSD' ? 0.01 : s.endsWith('JPY') ? 0.01 : 0.0001)
const mask = (t) => String(t).split(TOKEN).join('***')

async function rest(path, params) {
  const u = new URL(`https://eodhd.com/api${path}`)
  for (const [k, v] of Object.entries({ ...params, api_token: TOKEN, fmt: 'json' })) u.searchParams.set(k, String(v))
  const r = await fetch(u)
  if (!r.ok) throw new Error(mask(`HTTP ${r.status}`))
  return r.json()
}

async function freshness(label) {
  const now = Math.floor(Date.now() / 1000)
  const out = {}
  for (const s of ['EURUSD', 'XAUUSD']) {
    const bars = await rest(`/intraday/${s}.FOREX`, { interval: '1m', from: now - 6 * 3600, to: now })
    const last = Array.isArray(bars) ? bars.at(-1) : null
    out[s] = last ? `${Math.round((now - last.timestamp) / 60)} min temu (${last.datetime} UTC)` : 'brak świec z ostatnich 6 h'
  }
  console.log(`REST świeżość (${label}):`, out)
  return out
}

const stats = Object.fromEntries(SYMBOLS.map((s) => [s, { ticks: 0, live: 0, spreads: [], first: null }]))
const m1 = { bid: new Map(), mid: new Map() }
const fresh0 = await freshness('start')

const ws = new WebSocket(`wss://ws.eodhistoricaldata.com/ws/forex?api_token=${TOKEN}`)
const started = Date.now()
const statuses = []
ws.addEventListener('message', (ev) => {
  let m
  try {
    m = JSON.parse(String(ev.data))
  } catch {
    return
  }
  if (typeof m.s !== 'string') {
    statuses.push(mask(JSON.stringify(m)))
    if (m.status_code === 200) ws.send(JSON.stringify({ action: 'subscribe', symbols: SYMBOLS.join(',') }))
    return
  }
  const st = stats[m.s]
  if (!st) return
  st.ticks++
  const now = Date.now()
  if (m.t < now - 120_000) return // snapshot of an old quote
  st.live++
  st.first ??= now - started
  st.spreads.push((m.a - m.b) / PIP(m.s))
  if (m.s === 'EURUSD') {
    const minute = Math.floor(m.t / 60000) * 60
    for (const [mode, price] of [['bid', m.b], ['mid', (m.a + m.b) / 2]]) {
      const bars = m1[mode]
      const c = bars.get(minute)
      if (!c) bars.set(minute, { o: price, h: price, l: price, c: price })
      else Object.assign(c, { h: Math.max(c.h, price), l: Math.min(c.l, price), c: price })
    }
  }
})
ws.addEventListener('error', (e) => console.error('błąd WebSocket:', mask(e?.message ?? '')))
await new Promise((r) => setTimeout(r, MINUTES * 60_000))
ws.close()

console.log('\nStrumień:', statuses.join(' '))
for (const s of SYMBOLS) {
  const st = stats[s]
  const sp = st.spreads.sort((a, b) => a - b)
  console.log(
    `${s.padEnd(7)} ticki ${String(st.live).padStart(5)} (wszystkich ${st.ticks})  pierwszy żywy po ${st.first === null ? '—' : `${(st.first / 1000).toFixed(1)} s`}  spread mediana ${sp.length ? sp[sp.length >> 1].toFixed(2) : '—'} p` +
      (st.live === 0 ? '  ← CISZA' : '')
  )
}

// REST again after the window, then bid / mid against REST closes of the same minutes.
await new Promise((r) => setTimeout(r, 60_000))
const fresh1 = await freshness('koniec')
const minutes = [...m1.bid.keys()].sort((a, b) => a - b).slice(1, -1)
if (minutes.length) {
  const bars = await rest('/intraday/EURUSD.FOREX', { interval: '1m', from: minutes[0], to: minutes.at(-1) })
  const byT = new Map((Array.isArray(bars) ? bars : []).map((b) => [b.timestamp, b]))
  const d = { bid: [], mid: [] }
  for (const t of minutes) {
    const r = byT.get(t)
    if (!r) continue
    for (const mode of ['bid', 'mid']) d[mode].push((m1[mode].get(t).c - r.close) / 0.0001)
  }
  const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : '—')
  const mad = (a) => (a.length ? (a.reduce((x, y) => x + Math.abs(y), 0) / a.length).toFixed(3) : '—')
  console.log(`\nEURUSD close ze strumienia − close REST (pipsy), minut: ${d.bid.length}`)
  console.log(`  bid: średnio ${avg(d.bid)}, średnio |Δ| ${mad(d.bid)}`)
  console.log(`  mid: średnio ${avg(d.mid)}, średnio |Δ| ${mad(d.mid)}`)
  if (!d.bid.length) console.log('  REST nie ma jeszcze tych minut – porównanie wymaga powtórzenia później.')
}
console.log('\nPodsumowanie świeżości REST:', { start: fresh0, koniec: fresh1 })
