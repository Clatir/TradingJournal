import { mkdirSync, mkdtempSync, promises as fs, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)
const appVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version

// A dev build / win-unpacked is a "manual" copy: it only reports new versions (no download), which
// keeps this test free of installers. Downloading and swapping run in tests/fs/updater.test.ts and
// in the Windows CI update test against real builds.
test('aktualizacje: nowa wersja, opis zmian, sprawdzanie i preferencje', async () => {
  const release = { version: '9.9.0' }
  const server = createServer((req, res) => {
    if (req.url !== '/repos/Clatir/TradingJournal/releases/latest') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        tag_name: `v${release.version}`,
        name: `ICT Trade Journal ${release.version}`,
        body: '## Nowe\n- **duplikowanie** wpisów\n- aktualizacje z GitHuba\n\nPełna lista na stronie wydania.',
        published_at: '2026-10-01T10:00:00Z',
        html_url: `https://github.com/Clatir/TradingJournal/releases/tag/v${release.version}`,
        assets: []
      })
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // The previous run on this machine was an older version: "updated to …" is shown once.
  const userData = join(mkdtempSync(join(tmpdir(), 'ictj-e2e-')), 'userData')
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'config.json'), JSON.stringify({ updates: { lastRunVersion: '0.9.0' } }))
  const config = async () => JSON.parse(await fs.readFile(join(userData, 'config.json'), 'utf8')) as { updates: Record<string, any> }

  const { app, page, errors } = await launch({ userData, env: { ICTJ_UPDATE_URL: url, ICTJ_UPDATE_CHECK_DELAY_MS: '300' } })
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    await expect(page.getByTestId('banner-updated')).toContainText(`Zaktualizowano do wersji ${appVersion}.`)
    await expect(page.getByTestId('banner-update-available')).toContainText('Dostępna nowa wersja 9.9.0.')
    await expect.poll(async () => (await config()).updates.lastRunVersion).toBe(appVersion)
    await page.screenshot({ path: shots('43-aktualizacja-baner') })

    await page.getByTestId('banner-updated').getByTitle('Ukryj').click()
    await expect(page.getByTestId('banner-updated')).toHaveCount(0)

    await page.getByTestId('banner-update-available').getByRole('button', { name: 'Szczegóły' }).click()
    await expect(page.getByTestId('updates')).toBeVisible()
    await expect(page.getByTestId('current-version')).toHaveText(appVersion)
    await expect(page.getByTestId('update-status')).toContainText('Dostępna wersja 9.9.0.')
    await expect(page.getByTestId('release-notes')).toContainText('duplikowanie wpisów')
    await expect(page.getByTestId('release-notes').locator('li')).toHaveCount(2)
    await expect(page.getByTestId('open-release')).toContainText('Pobierz wersję 9.9.0 ze strony')
    // Nothing to download in a manual copy.
    await expect(page.getByTestId('toggle-auto-download')).toHaveCount(0)
    await expect(page.getByTestId('download-update')).toHaveCount(0)
    await page.screenshot({ path: shots('44-aktualizacje-ustawienia') })

    // Preferences are per machine (config.json in userData).
    await page.getByTestId('toggle-auto-check').getByRole('switch').click()
    await expect.poll(async () => (await config()).updates.prefs.autoCheck).toBe(false)

    // Banner hidden for this session with ×.
    await page.getByTestId('banner-update-available').getByTitle('Ukryj').click()
    await expect(page.getByTestId('banner-update-available')).toHaveCount(0)

    // The release becomes the running version: "up to date".
    release.version = appVersion
    await page.getByTestId('check-updates').click()
    await expect(page.getByTestId('update-status')).toContainText('Masz najnowszą wersję.')
    await expect(page.getByTestId('update-status')).toContainText('ostatnie sprawdzenie')

    // GitHub unavailable: a readable message, the app keeps working.
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
    await page.getByTestId('check-updates').click()
    await expect(page.getByTestId('update-status')).toContainText('Brak połączenia z GitHubem')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    if (server.listening) await new Promise<void>((r) => server.close(() => r()))
  }
})
