/**
 * The portable swap helper on its own, started exactly like the app starts it (a short-lived PowerShell
 * that launches the helper with Start-Process): waits for a process, replaces the file, writes its log.
 * No app build needed. (A PowerShell started directly as a detached process never runs – checked on CI.)
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startPortableSwap } from '../../src/main/update/apply'
import { PORTABLE, readText } from './util'

test.skip(process.platform !== 'win32', 'Windows only')

test('pomocnik podmiany: czeka na proces, podmienia plik, zapisuje log', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ictj-helper-'))
  const dir = join(root, "Moje programy O'Neil ąę")
  await fs.mkdir(dir, { recursive: true })
  const target = join(dir, PORTABLE)
  await fs.writeFile(target, 'stara wersja')
  await fs.writeFile(`${target}.update`, 'nowa wersja')
  await fs.writeFile(`${target}.old`, 'pozostałość')
  const logFile = join(root, 'logs', 'update.log')
  await fs.mkdir(join(root, 'logs'))
  // Stands in for the app: the swap must wait until it exits.
  const app = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 4'], { stdio: 'ignore' })
  const started = Date.now()
  startPortableSwap({ target, staged: `${target}.update`, waitPids: [app.pid!, 999_999], restart: false, logFile })
  try {
    await expect.poll(() => readText(target), { timeout: 60_000, intervals: [250] }).toBe('nowa wersja')
  } finally {
    console.log(`helper log after ${Date.now() - started} ms:\n${await readText(logFile)}\nfiles: ${(await fs.readdir(dir)).join(', ')}`)
  }
  const waited = Date.now() - started
  const log = await readText(logFile)
  expect(waited).toBeGreaterThan(2500)
  expect(log).toContain('swapped')
  expect(log).toContain('no restart requested')
  await expect.poll(() => fs.readdir(dir), { timeout: 10_000 }).toEqual([PORTABLE])
})
