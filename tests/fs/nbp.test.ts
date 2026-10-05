import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeNbpError, fetchNbpHistory, fetchNbpTable, nbpSource } from '../../src/main/fx/nbp'
import { fetchJson, HttpError } from '../../src/main/update/download'

const TABLE = [{ table: 'A', no: '192/A/NBP/2026', effectiveDate: '2026-10-02', rates: [{ currency: 'dolar amerykański', code: 'USD', mid: 3.8881 }] }]
const NOW = () => new Date('2026-10-02T12:15:00.000Z')

describe('pobieranie tabeli NBP (proces główny)', () => {
  let server: Server
  let base = ''
  const paths: string[] = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      paths.push(req.url ?? '')
      if (req.url?.startsWith('/broken')) {
        res.writeHead(500).end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(req.url?.startsWith('/garbage') ? JSON.stringify({ hello: 1 }) : JSON.stringify(TABLE))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server.close())

  it('adres: api.nbp.pl, serwer testowy (http dozwolony) albo „off”', () => {
    expect(nbpSource(undefined)).toEqual({ base: 'https://api.nbp.pl', allowInsecure: false })
    expect(nbpSource('')).toEqual({ base: 'https://api.nbp.pl', allowInsecure: false })
    expect(nbpSource('OFF')).toEqual({ base: null, allowInsecure: false })
    expect(nbpSource('http://127.0.0.1:9/')).toEqual({ base: 'http://127.0.0.1:9', allowInsecure: true })
  })

  it('„off”: nie łączy się wcale', async () => {
    let called = false
    const res = await fetchNbpTable(async () => ((called = true), new Response('[]')), { base: null, allowInsecure: false })
    expect(res.ok).toBe(false)
    expect(called).toBe(false)
  })

  it('pobiera tabelę A z serwera i zapisuje czas pobrania', async () => {
    const res = await fetchNbpTable(fetch, nbpSource(base), NOW)
    expect(res).toEqual({ ok: true, table: { no: '192/A/NBP/2026', effectiveDate: '2026-10-02', fetchedAt: '2026-10-02T12:15:00.000Z', rates: { USD: 3.8881 } } })
    expect(paths.at(-1)).toBe('/api/exchangerates/tables/A?format=json')
  })

  it('błąd serwera, zła odpowiedź, brak połączenia, http bez zgody', async () => {
    expect(await fetchNbpTable(fetch, { base: `${base}/broken`, allowInsecure: true })).toEqual({ ok: false, message: 'serwer NBP odpowiedział błędem 500' })
    expect(await fetchNbpTable(fetch, { base: `${base}/garbage`, allowInsecure: true })).toEqual({ ok: false, message: 'nieoczekiwana odpowiedź serwera NBP' })
    const offline = await fetchNbpTable(fetch, { base: 'http://127.0.0.1:1', allowInsecure: true })
    expect(offline).toEqual({ ok: false, message: 'brak połączenia z internetem albo serwer NBP nie odpowiada' })
    expect(await fetchNbpTable(fetch, { base, allowInsecure: false })).toEqual({ ok: false, message: 'dozwolone są tylko adresy https://' })
    expect(describeNbpError(new HttpError(404, 'x'))).toBe('serwer NBP odpowiedział błędem 404')
  })

  it('limit czasu obejmuje też treść odpowiedzi (serwer wysyła nagłówki i milknie)', async () => {
    const stalled = (async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })) as unknown as typeof fetch
    const started = Date.now()
    const err = await fetchJson(stalled, 'http://example.invalid/x', {}, 80).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('AbortError')
    expect(Date.now() - started).toBeLessThan(2000)
    expect(describeNbpError(err)).toBe('brak połączenia z internetem albo serwer NBP nie odpowiada')
  })
})

describe('kursy archiwalne NBP (proces główny)', () => {
  const source = { base: 'http://nbp.test', allowInsecure: true }
  it('zakres jednej waluty: adres rates/A/{kod}/{od}/{do}, 404 = brak tabel w zakresie', async () => {
    const urls: string[] = []
    const ok = await fetchNbpHistory(
      async (url) => (urls.push(url), new Response(JSON.stringify({ code: 'USD', rates: [{ no: '191/A/NBP/2026', effectiveDate: '2026-10-01', mid: 3.88 }] }))),
      source,
      'USD',
      '2026-09-25',
      '2026-10-02'
    )
    expect(ok).toEqual({ ok: true, rates: { '2026-10-01': 3.88 } })
    expect(urls).toEqual(['http://nbp.test/api/exchangerates/rates/A/USD/2026-09-25/2026-10-02/?format=json'])
    expect(await fetchNbpHistory(async () => new Response('Not Found', { status: 404 }), source, 'USD', '2026-01-01', '2026-01-01')).toEqual({ ok: true, rates: {} })
    expect(await fetchNbpHistory(async () => new Response('x', { status: 500 }), source, 'USD', '2026-01-01', '2026-01-02')).toEqual({ ok: false, message: 'serwer NBP odpowiedział błędem 500' })
  })

  it('odrzuca złe zakresy bez łączenia', async () => {
    let called = false
    const f = async () => ((called = true), new Response('{}'))
    expect((await fetchNbpHistory(f, source, 'PLN', '2026-01-01', '2026-01-02')).ok).toBe(false)
    expect((await fetchNbpHistory(f, source, 'USD', '2026-02-01', '2026-01-02')).ok).toBe(false)
    expect(await fetchNbpHistory(f, source, 'USD', '2025-01-01', '2026-01-03')).toEqual({ ok: false, message: 'zakres dłuższy niż 367 dni' }) // 368 days
    expect((await fetchNbpHistory(f, { base: null, allowInsecure: false }, 'USD', '2026-01-01', '2026-01-02')).ok).toBe(false)
    expect(called).toBe(false)
  })
})

