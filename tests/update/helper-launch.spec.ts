/**
 * Diagnostics (Windows CI): the same swap script started in different ways, to see which launch
 * survives as a background helper. Prints a table; never fails.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { encodePowerShell, portableSwapScript } from '../../src/main/update/apply'
import { PORTABLE, readText, sleep } from './util'

test.skip(process.platform !== 'win32', 'Windows only')

const PS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

async function prepare(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `ictj-launch-${name}-`))
  const target = join(dir, PORTABLE)
  await fs.writeFile(target, 'stara')
  await fs.writeFile(`${target}.update`, 'nowa')
  const logFile = join(dir, 'update.log')
  const encoded = encodePowerShell(portableSwapScript({ target, staged: `${target}.update`, waitPids: [], restart: false, logFile }))
  return { dir, target, logFile, encoded }
}

test('diagnostyka: sposoby uruchomienia pomocnika', async () => {
  test.setTimeout(120_000)
  const results: string[] = []
  const methods: Record<string, (encoded: string) => string> = {
    'A detached+hide': (enc) => {
      spawn(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { cwd: tmpdir(), detached: true, stdio: 'ignore', windowsHide: true }).unref()
      return ''
    },
    'B sync (child)': (enc) => {
      const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
      return `status=${r.status} signal=${r.signal} error=${r.error?.message ?? ''} stdout=${r.stdout} stderr=${r.stderr}`
    },
    'C detached': (enc) => {
      spawn(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { cwd: tmpdir(), detached: true, stdio: 'ignore' }).unref()
      return ''
    },
    'D two-stage Start-Process': (enc) => {
      const outer = `Start-Process -FilePath '${PS}' -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${enc}'`
      const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(outer)], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
      return `outer status=${r.status} stderr=${r.stderr}`
    },
    'E cmd start': (enc) => {
      spawn('cmd.exe', ['/d', '/c', `start "" /min "${PS}" -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${enc}`], {
        cwd: tmpdir(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true
      }).unref()
      return ''
    }
  }
  const runs: Array<{ name: string; target: string; logFile: string; note: string; started: number }> = []
  for (const [name, start] of Object.entries(methods)) {
    const p = await prepare(name.split(' ')[0]!)
    const started = Date.now()
    let note = ''
    try {
      note = start(p.encoded)
    } catch (e) {
      note = `throw ${String(e)}`
    }
    runs.push({ name, target: p.target, logFile: p.logFile, note, started })
  }
  await sleep(25_000)
  for (const r of runs) {
    const content = await readText(r.target)
    results.push(`${r.name}: target=${JSON.stringify(content)} log=${JSON.stringify(await readText(r.logFile))} ${r.note}`)
  }
  console.log(`\n===== helper launch methods\n${results.join('\n')}`)
})
