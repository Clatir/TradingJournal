/**
 * End-to-end update on Windows (CI): the current build (release/) finds the next version (release-next/,
 * built with the following patch number) on a local stand-in for GitHub Releases, downloads it in the
 * background and replaces itself – the portable exe in place, the installed app with the silent
 * installer – then starts the new version.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdtempSync, promises as fs, readFileSync, statSync } from 'node:fs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron, chromium, expect, test, type Browser, type Page } from '@playwright/test'

const FROM = resolve(process.env.ICTJ_UPDATE_FROM ?? 'release')
const TO = resolve(process.env.ICTJ_UPDATE_TO ?? 'release-next')
const NEXT = process.env.ICTJ_UPDATE_TO_VERSION ?? ''
const CURRENT = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const PORTABLE = 'ICT-Trade-Journal-portable.exe'
const SETUP = 'ICT-Trade-Journal-Setup.exe'
const APP_EXE = 'ICT Trade Journal.exe'
const shots = (name: string) => join('test-results', 'screens', `${name}.png`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.skip(process.platform !== 'win32' || !NEXT, 'Windows CI only: needs the next version built into release-next (ci.yml)')
test.describe.configure({ mode: 'serial' })

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function powershell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim()
}

function appProcessPaths(): string[] {
  const out = powershell(`Get-Process -Name 'ICT Trade Journal' -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }`)
  return out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []
}

/** Close the app like the user would (window close → save → quit), force after a while. */
async function stopApp(): Promise<void> {
  spawnSync('taskkill', ['/IM', APP_EXE], { stdio: 'ignore' })
  for (let i = 0; i < 40 && appProcessPaths().length; i++) await sleep(500)
  spawnSync('taskkill', ['/F', '/T', '/IM', APP_EXE], { stdio: 'ignore' })
  spawnSync('taskkill', ['/F', '/IM', PORTABLE], { stdio: 'ignore' })
}

/** The per-user installation from the uninstall registry key written by the NSIS installer. */
function installed(): { dir: string; version: string } | null {
  const out = powershell(
    `Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -like 'ICT Trade Journal*' } | Select-Object -First 1 | ForEach-Object { $_.DisplayVersion + '|' + $_.UninstallString }`
  )
  const [version, uninstall] = out.split('|')
  const uninstaller = /"([^"]+)"/.exec(uninstall ?? '')?.[1]
  return version && uninstaller ? { version: version.trim(), dir: dirname(uninstaller) } : null
}

/** Version from package.json inside resources/app.asar (asar: 8-byte size pickle, JSON header pickle, files). */
async function asarVersion(asar: string): Promise<string> {
  const fd = await fs.open(asar, 'r')
  try {
    const head = Buffer.alloc(16)
    await fd.read(head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const json = Buffer.alloc(head.readUInt32LE(12))
    await fd.read(json, 0, json.length, 16)
    const entry = (JSON.parse(json.toString('utf8')) as { files: Record<string, { offset: string; size: number }> }).files['package.json']!
    const pkg = Buffer.alloc(entry.size)
    await fd.read(pkg, 0, entry.size, 8 + headerSize + Number(entry.offset))
    return (JSON.parse(pkg.toString('utf8')) as { version: string }).version
  } finally {
    await fd.close()
  }
}

let server: Server
let base = ''

test.beforeAll(async () => {
  const files = [PORTABLE, SETUP]
  const sums = (await Promise.all(files.map(async (f) => `${await sha256(join(TO, f))}  ${f}\n`))).join('')
  server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '/')
    if (url === '/repos/Clatir/TradingJournal/releases/latest') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          tag_name: `v${NEXT}`,
          name: `ICT Trade Journal ${NEXT}`,
          body: `## Test aktualizacji\n- wersja ${NEXT} zbudowana w CI`,
          published_at: new Date().toISOString(),
          html_url: `https://github.com/Clatir/TradingJournal/releases/tag/v${NEXT}`,
          assets: [
            ...files.map((f) => ({ name: f, size: statSync(join(TO, f)).size, browser_download_url: `${base}/download/${f}` })),
            { name: 'SHA256SUMS.txt', size: Buffer.byteLength(sums), browser_download_url: `${base}/download/SHA256SUMS.txt` }
          ]
        })
      )
      return
    }
    const name = url.replace(/^\/download\//, '')
    if (name === 'SHA256SUMS.txt') {
      res.end(sums)
      return
    }
    if (!files.includes(name)) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Length': String(statSync(join(TO, name)).size), 'Content-Type': 'application/octet-stream' })
    createReadStream(join(TO, name)).pipe(res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  server?.closeAllConnections()
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
})

function appEnv(root: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    ICTJ_USER_DATA: join(root, 'userData'),
    ICTJ_DATA_DIR: join(root, 'Dziennik'),
    ICTJ_MACHINE_NAME: 'CI-UPDATE',
    ICTJ_UPDATE_URL: base,
    ICTJ_UPDATE_CHECK_DELAY_MS: '1000',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
}

/** The click starts quitting; the window may be gone before Playwright finishes the action. */
const ignoreClosed = (e: unknown) => {
  if (!/closed|Target|disconnected/i.test(String(e))) throw e
}

const devtoolsUp = (port: number) => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false)

async function appPage(browser: Browser): Promise<Page> {
  for (let i = 0; i < 240; i++) {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('index.html'))
    if (page) return page
    await sleep(500)
  }
  throw new Error('Okno aplikacji nie pojawiło się w DevTools.')
}

test('portable: pobranie w tle, podmiana exe po zamknięciu i start nowej wersji', async () => {
  test.setTimeout(15 * 60_000)
  const root = mkdtempSync(join(tmpdir(), 'ictj-upd-'))
  const dir = join(root, 'Moje programy') // a space in the path, like most user folders
  await fs.mkdir(dir, { recursive: true })
  const exe = join(dir, PORTABLE)
  await fs.copyFile(join(FROM, PORTABLE), exe)
  const userData = join(root, 'userData')
  const nextHash = await sha256(join(TO, PORTABLE))
  // The portable launcher passes its arguments to the app: DevTools endpoint for the test.
  const port = 9300 + Math.floor(Math.random() * 600)
  const launcher = spawn(exe, [`--remote-debugging-port=${port}`], { env: appEnv(root), stdio: 'ignore' })
  launcher.on('error', (e) => console.error('launcher', e))
  let browser: Browser | null = null
  try {
    await expect.poll(() => devtoolsUp(port), { timeout: 180_000, intervals: [1000] }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = await appPage(browser)
    const ready = page.getByTestId('banner-update-ready')
    await expect(ready).toBeVisible({ timeout: 300_000 })
    await expect(ready).toContainText(`Wersja ${NEXT} jest pobrana`)
    expect(await sha256(`${exe}.update`)).toBe(nextHash)
    await page.screenshot({ path: shots('90-aktualizacja-portable-gotowa') })

    await page.getByTestId('banner-restart-update').click().catch(ignoreClosed)
    // The helper waits for the app and the launcher to exit, moves the new exe in and starts it.
    await expect.poll(() => sha256(exe).catch(() => ''), { timeout: 300_000, intervals: [1000] }).toBe(nextHash)
    const mainLog = join(userData, 'logs', 'main.log')
    await expect.poll(() => fs.readFile(mainLog, 'utf8').catch(() => ''), { timeout: 180_000, intervals: [1000] }).toContain(`updated ${CURRENT} -> ${NEXT}`)
    const helperLog = await fs.readFile(join(userData, 'logs', 'update.log'), 'utf8')
    console.log(helperLog)
    expect(helperLog).toContain('swapped')
    expect(helperLog).toContain('restarted')
    expect(existsSync(`${exe}.update`)).toBe(false)
    expect(existsSync(`${exe}.old`)).toBe(false)
  } finally {
    await browser?.close().catch(() => undefined)
    await stopApp()
  }
})

test('zainstalowana: cichy instalator nowej wersji w tym samym folderze i start nowej wersji', async () => {
  test.setTimeout(15 * 60_000)
  const root = mkdtempSync(join(tmpdir(), 'ictj-inst-'))
  const setup = spawnSync(join(FROM, SETUP), ['/S'], { stdio: 'ignore', timeout: 600_000 })
  expect(setup.status).toBe(0)
  await expect.poll(() => installed()?.version, { timeout: 120_000, intervals: [1000] }).toBe(CURRENT)
  const before = installed()!
  const exe = join(before.dir, APP_EXE)
  expect(existsSync(join(before.dir, 'Uninstall ICT Trade Journal.exe'))).toBe(true)
  expect(await asarVersion(join(before.dir, 'resources', 'app.asar'))).toBe(CURRENT)

  const app = await electron.launch({ executablePath: exe, env: appEnv(root) })
  try {
    const page = await app.firstWindow()
    const ready = page.getByTestId('banner-update-ready')
    await expect(ready).toBeVisible({ timeout: 300_000 })
    await expect(ready).toContainText(`Wersja ${NEXT} jest pobrana`)
    expect(await sha256(join(root, 'userData', 'updates', SETUP))).toBe(await sha256(join(TO, SETUP)))
    await page.screenshot({ path: shots('91-aktualizacja-instalator-gotowa') })

    const closed = app.waitForEvent('close', { timeout: 120_000 })
    await page.getByTestId('banner-restart-update').click().catch(ignoreClosed)
    await closed

    await expect.poll(() => installed()?.version, { timeout: 300_000, intervals: [2000] }).toBe(NEXT)
    expect(installed()!.dir.toLowerCase()).toBe(before.dir.toLowerCase())
    await expect.poll(() => asarVersion(join(before.dir, 'resources', 'app.asar')).catch(() => ''), { timeout: 120_000, intervals: [2000] }).toBe(NEXT)
    // --force-run: the installer starts the new version by itself.
    await expect
      .poll(() => appProcessPaths().some((p) => p.toLowerCase() === exe.toLowerCase()), { timeout: 180_000, intervals: [1000] })
      .toBe(true)
    console.log(await fs.readFile(join(root, 'userData', 'logs', 'main.log'), 'utf8').catch(() => '(brak main.log w userData testu)'))
  } finally {
    await stopApp()
  }
})
