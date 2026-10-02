import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export const PORTABLE = 'ICT-Trade-Journal-portable.exe'
export const SETUP = 'ICT-Trade-Journal-Setup.exe'
export const APP_EXE = 'ICT Trade Journal.exe'
export const shots = (name: string) => join('test-results', 'screens', `${name}.png`)
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export const readText = (file: string) => fs.readFile(file, 'utf8').catch(() => '')

/** Output of a Windows PowerShell command; never throws (a cmdlet finding nothing sets exit code 1). */
export function powershell(script: string): string {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  return (r.stdout ?? '').trim()
}

export function appProcessPaths(): string[] {
  const out = powershell(`Get-Process -Name 'ICT Trade Journal' -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }`)
  return out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []
}

/** Close the app like the user would (window close → save → quit), force after a while. Never throws. */
export async function stopApp(): Promise<void> {
  spawnSync('taskkill', ['/IM', APP_EXE], { stdio: 'ignore' })
  for (let i = 0; i < 40 && appProcessPaths().length; i++) await sleep(500)
  spawnSync('taskkill', ['/F', '/T', '/IM', APP_EXE], { stdio: 'ignore' })
  spawnSync('taskkill', ['/F', '/IM', PORTABLE], { stdio: 'ignore' })
}

/** Everything that explains a failed update, printed into the CI log. */
export async function dump(title: string, userData: string, dirs: string[]): Promise<void> {
  const lines = [`===== ${title}`]
  const config = await readText(join(userData, 'config.json'))
  lines.push('--- config.json updates:', JSON.stringify((JSON.parse(config || '{}') as { updates?: unknown }).updates ?? null))
  lines.push('--- logs/main.log:', (await readText(join(userData, 'logs', 'main.log'))).split('\n').slice(-80).join('\n'))
  lines.push('--- logs/update.log:', await readText(join(userData, 'logs', 'update.log')))
  for (const dir of dirs) {
    const names = await fs.readdir(dir).catch((e: Error) => [`(${e.message})`])
    const sized = await Promise.all(names.map(async (n) => `${n} ${(await fs.stat(join(dir, n)).catch(() => null))?.size ?? ''}`))
    lines.push(`--- ${dir}:`, sized.join('\n'))
  }
  lines.push('--- processes:', appProcessPaths().join('\n'), powershell(`Get-Process -Name 'ICT-Trade-Journal-portable','powershell' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id.ToString() + ' ' + $_.Path }`))
  console.log(lines.join('\n'))
}
