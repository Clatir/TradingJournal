/**
 * End-to-end update on Windows (CI): the current build (release/) finds the next version (release-next/,
 * built with the following patch number) on a local stand-in for GitHub Releases, downloads it in the
 * background and replaces itself – the portable exe in place, the installed app with the silent
 * installer – then starts the new version. Each step has its own deadline; on failure the logs of the
 * app and of the swap helper are printed into the CI log.
 */
import { createReadStream, existsSync, mkdtempSync, promises as fs, readFileSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron, chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { APP_EXE, PORTABLE, SETUP, appProcessPaths, dump, powershell, readText, sha256, shots, sleep, stopApp } from './util'

const FROM = resolve(process.env.ICTJ_UPDATE_FROM ?? 'release')
const TO = resolve(process.env.ICTJ_UPDATE_TO ?? 'release-next')
const NEXT = process.env.ICTJ_UPDATE_TO_VERSION ?? ''
const CURRENT = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version

test.skip(process.platform !== 'win32' || !NEXT, 'Windows CI only: needs the next version built into release-next (ci.yml)')
test.describe.configure({ mode: 'serial' })

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
const hits: string[] = []

test.beforeAll(async () => {
  const files = [PORTABLE, SETUP]
  const sums = (await Promise.all(files.map(async (f) => `${await sha256(join(TO, f))}  ${f}\n`))).join('')
  server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '/')
    hits.push(url)
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
  test.setTimeout(12 * 60_000)
  const root = mkdtempSync(join(tmpdir(), 'ictj-upd-'))
  const dir = join(root, 'Moje programy') // a space in the path, like most user folders
  await fs.mkdir(dir, { recursive: true })
  const exe = join(dir, PORTABLE)
  await fs.copyFile(join(FROM, PORTABLE), exe)
  const userData = join(root, 'userData')
  const mainLog = join(userData, 'logs', 'main.log')
  const nextHash = await sha256(join(TO, PORTABLE))
  // The portable launcher passes its arguments to the app: DevTools endpoint for the test.
  const port = 9300 + Math.floor(Math.random() * 600)
  const launcher = spawn(exe, [`--remote-debugging-port=${port}`], { env: appEnv(root), stdio: 'ignore' })
  launcher.on('error', (e) => console.error('launcher', e))
  let browser: Browser | null = null
  let step = 'start aplikacji portable (DevTools)'
  try {
    await expect.poll(() => devtoolsUp(port), { timeout: 120_000, intervals: [1000] }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
    const page = await appPage(browser)

    step = 'sprawdzenie i pobranie w tle'
    await expect.poll(() => readText(mainLog), { timeout: 60_000, intervals: [500] }).toMatch(/update ready|update download failed|update check failed/)
    const ready = page.getByTestId('banner-update-ready')
    await expect(ready).toBeVisible({ timeout: 30_000 })
    await expect(ready).toContainText(`Wersja ${NEXT} jest pobrana`)
    expect(await sha256(`${exe}.update`)).toBe(nextHash)
    await page.screenshot({ path: shots('90-aktualizacja-portable-gotowa') })

    step = 'zamknięcie aplikacji i start pomocnika'
    await page.getByTestId('banner-restart-update').click().catch(ignoreClosed)
    await expect.poll(() => readText(mainLog), { timeout: 60_000, intervals: [500] }).toContain(`installing update ${NEXT} (portable, restart=true)`)

    step = 'podmiana exe przez pomocnika'
    await expect.poll(() => sha256(exe).catch(() => ''), { timeout: 180_000, intervals: [1000] }).toBe(nextHash)
    expect(existsSync(`${exe}.update`)).toBe(false)
    expect(existsSync(`${exe}.old`)).toBe(false)

    step = 'start nowej wersji'
    await expect.poll(() => readText(mainLog), { timeout: 120_000, intervals: [1000] }).toContain(`updated ${CURRENT} -> ${NEXT}`)
    const helperLog = await readText(join(userData, 'logs', 'update.log'))
    expect(helperLog).toContain('swapped')
    expect(helperLog).toContain('restarted')
    await dump('portable: OK', userData, [dir])
  } catch (e) {
    console.log(`Nieudany etap: ${step}; zapytania do serwera: ${hits.join(', ')}`)
    await dump(`portable: ${step}`, userData, [dir])
    throw e
  } finally {
    await browser?.close().catch(() => undefined)
    await stopApp()
  }
})

test('zainstalowana: cichy instalator nowej wersji w tym samym folderze i start nowej wersji', async () => {
  test.setTimeout(12 * 60_000)
  const root = mkdtempSync(join(tmpdir(), 'ictj-inst-'))
  const userData = join(root, 'userData')
  const mainLog = join(userData, 'logs', 'main.log')
  let step = 'instalacja bieżącej wersji (Setup /S)'
  let installDir = ''
  try {
    const setup = spawnSync(join(FROM, SETUP), ['/S'], { stdio: 'ignore', timeout: 600_000 })
    expect(setup.status).toBe(0)
    await expect.poll(() => installed()?.version, { timeout: 120_000, intervals: [1000] }).toBe(CURRENT)
    const before = installed()!
    installDir = before.dir
    const exe = join(before.dir, APP_EXE)
    expect(existsSync(join(before.dir, 'Uninstall ICT Trade Journal.exe'))).toBe(true)
    expect(await asarVersion(join(before.dir, 'resources', 'app.asar'))).toBe(CURRENT)

    step = 'sprawdzenie i pobranie w tle'
    const app = await electron.launch({ executablePath: exe, env: appEnv(root) })
    const page = await app.firstWindow()
    await expect.poll(() => readText(mainLog), { timeout: 60_000, intervals: [500] }).toMatch(/update ready|update download failed|update check failed/)
    const ready = page.getByTestId('banner-update-ready')
    await expect(ready).toBeVisible({ timeout: 30_000 })
    await expect(ready).toContainText(`Wersja ${NEXT} jest pobrana`)
    expect(await sha256(join(userData, 'updates', SETUP))).toBe(await sha256(join(TO, SETUP)))
    await page.screenshot({ path: shots('91-aktualizacja-instalator-gotowa') })

    step = 'zamknięcie aplikacji i start instalatora'
    const closed = app.waitForEvent('close', { timeout: 120_000 })
    await page.getByTestId('banner-restart-update').click().catch(ignoreClosed)
    await closed
    expect(await readText(mainLog)).toContain(`installing update ${NEXT} (installer, restart=true)`)

    step = 'cicha instalacja nowej wersji'
    await expect.poll(() => installed()?.version, { timeout: 300_000, intervals: [2000] }).toBe(NEXT)
    expect(installed()!.dir.toLowerCase()).toBe(before.dir.toLowerCase())
    await expect.poll(() => asarVersion(join(before.dir, 'resources', 'app.asar')).catch(() => ''), { timeout: 120_000, intervals: [2000] }).toBe(NEXT)

    // --force-run: the installer starts the new version by itself.
    step = 'start nowej wersji po instalacji'
    await expect
      .poll(() => appProcessPaths().some((p) => p.toLowerCase() === exe.toLowerCase()), { timeout: 180_000, intervals: [1000] })
      .toBe(true)
    await dump('zainstalowana: OK', userData, [before.dir, join(userData, 'updates')])
  } catch (e) {
    console.log(`Nieudany etap: ${step}; zapytania do serwera: ${hits.join(', ')}`)
    await dump(`zainstalowana: ${step}`, userData, [installDir || root, join(userData, 'updates')])
    throw e
  } finally {
    await stopApp()
  }
})
