import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface Launched {
  app: ElectronApplication
  page: Page
  dataDir: string
  userData: string
  /** Uncaught renderer errors and console.error messages. */
  errors: string[]
}

/**
 * Launch the built app (out/) or a packaged executable (ICTJ_E2E_EXECUTABLE, used on Windows CI)
 * with an isolated user-data folder and a preselected data folder.
 */
export async function launch(
  opts: { dataDir?: string; userData?: string; machine?: string; usePreset?: boolean; env?: Record<string, string> } = {}
): Promise<Launched> {
  const base = mkdtempSync(join(tmpdir(), 'ictj-e2e-'))
  const dataDir = opts.dataDir ?? join(base, 'Dziennik')
  const userData = opts.userData ?? join(base, 'userData')
  const env = {
    ...process.env,
    ICTJ_USER_DATA: userData,
    ICTJ_DATA_DIR: dataDir,
    ICTJ_MACHINE_NAME: opts.machine ?? 'E2E-PC',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    ...opts.env
  } as Record<string, string>
  delete env.ELECTRON_RENDERER_URL
  if (opts.usePreset === false) delete env.ICTJ_DATA_DIR
  const executable = process.env.ICTJ_E2E_EXECUTABLE
  const app = executable
    ? await electron.launch({ executablePath: executable, env, args: process.platform === 'win32' ? [] : ['--no-sandbox'] })
    : await electron.launch({ args: [resolve('.'), '--no-sandbox'], env })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.waitForLoadState('domcontentloaded')
  // Stable screenshots: no transitions.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return { app, page, dataDir, userData, errors }
}
