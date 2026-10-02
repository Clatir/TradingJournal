/**
 * Applying a downloaded update (Windows).
 *
 * Portable: the portable exe is an NSIS launcher that unpacks the app to a temp folder and keeps its own
 * file open (FILE_SHARE_READ, no rename/delete) until the app exits. So the swap is done by a small
 * detached PowerShell helper that waits for the app and the launcher to exit, moves the new exe in place
 * (keeping the old one until the move succeeded) and optionally starts it again.
 *
 * Installer: the NSIS installer runs silently (/S --updated) into the existing installation folder; it
 * waits for the app to exit by itself. --force-run starts the new version afterwards.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

/** Single-quoted PowerShell literal (no expansion; a quote is escaped by doubling it). */
export function psLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/** -EncodedCommand payload: base64 of UTF-16LE, immune to command-line quoting and code pages. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export interface PortableSwapParams {
  /** The portable exe being replaced (PORTABLE_EXECUTABLE_FILE). */
  target: string
  /** Verified new exe, next to the target (same volume, so the move is a rename). */
  staged: string
  /** Processes that must exit first: the app and the portable launcher. */
  waitPids: number[]
  restart: boolean
  logFile: string
}

export function portableSwapScript(p: PortableSwapParams): string {
  const pids = p.waitPids.filter((n) => Number.isInteger(n) && n > 0).join(', ')
  return `$ErrorActionPreference = 'Continue'
$target = ${psLiteral(p.target)}
$staged = ${psLiteral(p.staged)}
$backup = $target + '.old'
$log = ${psLiteral(p.logFile)}
function Log([string]$m) { try { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o') + ' update-helper ' + $m) -Encoding UTF8 } catch {} }
Log 'start'
foreach ($id in @(${pids})) {
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($proc) { $null = $proc.WaitForExit(120000) }
}
$ok = $false
for ($i = 0; $i -lt 120 -and -not $ok; $i++) {
  if (-not (Test-Path -LiteralPath $staged)) { Log 'staged file missing'; break }
  try {
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction Stop }
    if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup -Force -ErrorAction Stop }
    try {
      Move-Item -LiteralPath $staged -Destination $target -Force -ErrorAction Stop
      $ok = $true
    } catch {
      if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $target -Force -ErrorAction SilentlyContinue }
      throw
    }
  } catch {
    Log ('attempt ' + $i + ': ' + $_.Exception.Message)
    Start-Sleep -Milliseconds 500
  }
}
if ($ok) {
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  Log 'swapped'
} else {
  Log 'swap failed - the current version stays'
}
${p.restart ? `if (Test-Path -LiteralPath $target) { Start-Process -FilePath $target -WorkingDirectory (Split-Path -Parent $target); Log 'restarted' }` : `Log 'no restart requested'`}
`
}

function powershellExe(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Start the swap helper; it outlives the app. */
export function startPortableSwap(p: PortableSwapParams): void {
  // A detached console process gets no console window at all; -EncodedCommand is not a script file,
  // so the execution policy does not apply.
  const child = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(portableSwapScript(p))], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}

export function installerArgs(restart: boolean): string[] {
  return ['--updated', '/S', ...(restart ? ['--force-run'] : [])]
}

/** Run the downloaded NSIS installer silently; it replaces the installed app once this process exits. */
export function startSilentInstaller(setupPath: string, restart: boolean): void {
  const child = spawn(setupPath, installerArgs(restart), { detached: true, stdio: 'ignore' })
  child.unref()
}
