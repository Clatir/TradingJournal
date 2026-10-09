/**
 * Applying a downloaded update (Windows).
 *
 * Portable: the portable exe is an NSIS launcher that unpacks the app to a temp folder and keeps its own
 * file open (FILE_SHARE_READ, no rename/delete) until the app exits. So the swap is done by a small
 * PowerShell helper (started so that it outlives the app) that waits for the app and the launcher to
 * exit, moves the new exe in place (keeping the old one until the move succeeded) and optionally starts
 * it again.
 *
 * Installer: the NSIS installer runs silently (/S --updated) into the existing installation folder; it
 * waits for the app to exit by itself. --force-run starts the new version afterwards.
 *
 * With a restart, a small status window (from the helper) covers the time until the new version's window appears
 * and says so when it does not; every step goes to logs/update.log.
 */
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
  /** The new version (shown while updating). */
  version?: string
  /** Process name of the app ("ICT Trade Journal"): its new window ends the status window. */
  appProcess?: string
}

/** How long a restart may take before the status window says so (unpacking + antivirus scan of ~100 MB). */
const WINDOW_TIMEOUT_S = 180

/**
 * PowerShell shared by the helpers: logging (retried on a briefly locked file) and a small status window shown
 * from the app's exit until the new version's window appears – without it the update looks like the app just
 * closed (the portable exe unpacks ~250 MB first, an antivirus scans the new file). Any UI failure leaves the
 * helper working without it.
 */
function helperPreamble(logFile: string, title: string | null): string {
  return `$ErrorActionPreference = 'Continue'
$log = ${psLiteral(logFile)}
$started = Get-Date
function Log([string]$m) {
  # -ErrorAction Stop: with 'Continue' a briefly locked file (antivirus, a reader) would drop the line silently.
  $line = (Get-Date).ToString('o') + ' update-helper ' + $m
  for ($t = 0; $t -lt 20; $t++) {
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 -ErrorAction Stop; return } catch { Start-Sleep -Milliseconds 100 }
  }
}
$form = $null
$label = $null
${
  title == null
    ? ''
    : `try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form = New-Object System.Windows.Forms.Form
  # Enum and colour values as text (converted on assignment): a type literal that fails to resolve would stop the
  # whole script before any try / catch.
  $form.Text = 'ICT Trade Journal'
  $form.FormBorderStyle = 'FixedToolWindow'
  $form.StartPosition = 'CenterScreen'
  $form.ClientSize = New-Object System.Drawing.Size(420, 90)
  $form.TopMost = $true
  $form.ControlBox = $false
  $form.BackColor = '17, 20, 24'
  $form.ForeColor = '232, 163, 61'
  $label = New-Object System.Windows.Forms.Label
  $label.Dock = 'Fill'
  $label.TextAlign = 'MiddleCenter'
  $label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $label.Text = ${psLiteral(title)}
  $form.Controls.Add($label)
  $form.Show()
  $form.Refresh()
} catch { Log ('no status window: ' + $_.Exception.Message); $form = $null }`
}
function Status([string]$text) {
  if ($form) { try { $label.Text = $text; [System.Windows.Forms.Application]::DoEvents() } catch { } }
}
# Sleep while keeping the status window responsive.
function Pump([int]$ms) {
  $end = (Get-Date).AddMilliseconds($ms)
  do {
    if ($form) { try { [System.Windows.Forms.Application]::DoEvents() } catch { } }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $end)
}
function Close-Status { if ($form) { try { $form.Close(); $form.Dispose() } catch { } } }
function Seconds { [math]::Round(((Get-Date) - $started).TotalSeconds, 1) }
`
}

/** Wait until a window of the app started after the helper shows up; tell when it does not. */
function waitForWindow(appProcess: string, timeoutS: number): string {
  return `$appName = ${psLiteral(appProcess)}
$deadline = (Get-Date).AddSeconds(${timeoutS})
$shown = $false
while (-not $shown -and (Get-Date) -lt $deadline) {
  foreach ($q in @(Get-Process -Name $appName -ErrorAction SilentlyContinue)) {
    try { if ($q.MainWindowHandle -ne 0 -and $q.StartTime -gt $started) { $shown = $true } } catch { }
  }
  if (-not $shown) { Pump 300 }
}
if ($shown) {
  Log ('new window after ' + (Seconds) + ' s')
} else {
  Log ('no window of the new version after ${timeoutS} s')
  Status 'Nowa wersja nie uruchomiła się sama – uruchom aplikację ręcznie.'
  Pump 10000
}
`
}

export function portableSwapScript(p: PortableSwapParams): string {
  const pids = p.waitPids.filter((n) => Number.isInteger(n) && n > 0).join(', ')
  const title = p.restart ? `Aktualizacja${p.version ? ` do wersji ${p.version}` : ''}… aplikacja zaraz uruchomi się ponownie.` : null
  return `${helperPreamble(p.logFile, title)}$target = ${psLiteral(p.target)}
$staged = ${psLiteral(p.staged)}
$backup = $target + '.old'
Log ('start' + ${p.version ? psLiteral(` (version ${p.version}, restart=${p.restart})`) : psLiteral(` (restart=${p.restart})`)})
foreach ($id in @(${pids})) {
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($proc) {
    $until = (Get-Date).AddSeconds(120)
    while (-not $proc.HasExited -and (Get-Date) -lt $until) { Pump 200 }
    Log ('process ' + $id + $(if ($proc.HasExited) { ' exited' } else { ' still running after 120 s' }) + ' at ' + (Seconds) + ' s')
  }
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
    Pump 500
  }
}
if ($ok) {
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  Log ('swapped at ' + (Seconds) + ' s')
} else {
  Log 'swap failed - the current version stays'
  Status 'Nie udało się podmienić pliku – zostaje obecna wersja. Uruchamiam ją…'
}
${
  p.restart
    ? `if (Test-Path -LiteralPath $target) {
  try {
    $child = Start-Process -FilePath $target -WorkingDirectory (Split-Path -Parent $target) -PassThru -ErrorAction Stop
    Log ('restarted (pid ' + $child.Id + ')')
    Status 'Uruchamiam nową wersję…'
${p.appProcess ? waitForWindow(p.appProcess, WINDOW_TIMEOUT_S).replace(/^/gm, '    ') : ''}
  } catch {
    Log ('restart failed: ' + $_.Exception.Message)
    Status 'Nie udało się uruchomić aplikacji – uruchom ją ręcznie.'
    Pump 10000
  }
}`
    : `Log 'no restart requested'`
}
Close-Status
`
}

export interface RestartWatchParams {
  version: string
  appProcess: string
  logFile: string
}

/** Installer mode: the status window while the silent installer works and starts the new version (--force-run). */
export function restartWatchScript(p: RestartWatchParams): string {
  return `${helperPreamble(p.logFile, `Instaluję wersję ${p.version}… aplikacja zaraz uruchomi się ponownie.`)}Log ${psLiteral(`installer started (version ${p.version}), waiting for the new window`)}
${waitForWindow(p.appProcess, WINDOW_TIMEOUT_S + 120)}Close-Status
`
}

function powershellExe(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Start the swap helper; it outlives the app. Windows PowerShell started as a detached process (no
 * console) does not run at all, and a normal child process is killed together with the app (libuv job
 * object). So a short-lived child PowerShell with a hidden console starts the helper via Start-Process:
 * the helper gets its own hidden console and, as a grandchild, is not part of the app's job.
 * Synchronous on purpose – the app quits right after this (~1 s).
 */
export function startPortableSwap(p: PortableSwapParams): void {
  startHelper(portableSwapScript(p))
}

/**
 * The command that runs a helper script: a short loader of the script saved to a file. The script itself would not
 * fit – the starter encodes it twice and a command line holds 32k characters. A script block made from the text is
 * not subject to the execution policy (unlike -File).
 */
export function helperBootstrap(scriptFile: string): string {
  return `$f = ${psLiteral(scriptFile)}; $s = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8); Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue; & ([scriptblock]::Create($s))`
}

function startHelper(script: string): void {
  const ps = powershellExe()
  const file = join(tmpdir(), `ictj-update-${process.pid}-${Date.now()}.ps1`)
  writeFileSync(file, script, 'utf8')
  // -Sta: the status window (Windows Forms) needs a single-threaded apartment.
  const helperArgs = ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', encodePowerShell(helperBootstrap(file))]
  const starter = `Start-Process -FilePath ${psLiteral(ps)} -WindowStyle Hidden -WorkingDirectory ${psLiteral(tmpdir())} -ArgumentList ${helperArgs.map(psLiteral).join(',')}`
  const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(starter)], {
    cwd: tmpdir(),
    stdio: 'ignore',
    windowsHide: true,
    timeout: 30_000
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`update helper did not start (exit code ${r.status})`)
}

export function installerArgs(restart: boolean): string[] {
  return ['--updated', '/S', ...(restart ? ['--force-run'] : [])]
}

/**
 * Run the downloaded NSIS installer silently; it replaces the installed app once this process exits. With a restart,
 * a helper shows the status until the new version's window appears.
 */
export function startSilentInstaller(setupPath: string, restart: boolean, watch?: RestartWatchParams): void {
  // Not the installation folder as the working folder: the installer replaces it.
  const child = spawn(setupPath, installerArgs(restart), { cwd: dirname(setupPath), detached: true, stdio: 'ignore' })
  child.unref()
  if (restart && watch) {
    try {
      startHelper(restartWatchScript(watch))
    } catch {
      // Only the status window is missing; the installer runs and starts the new version.
    }
  }
}
