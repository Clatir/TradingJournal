<#
  Builds the Windows .exe files with the Node.js version pinned in .node-version, independent of the
  Node.js installed on this computer (any version, or none). The pinned Node.js is downloaded once into
  .tools\ (checksum verified) and used only by this script; system settings and PATH stay untouched.

  Usage: double-click build-windows.cmd, or in a terminal:  .\build-windows.cmd [-SkipTests]
#>
param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1: the progress bar makes Invoke-WebRequest many times slower; TLS 1.2 for nodejs.org.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Step([string]$text) {
  Write-Host ''
  Write-Host "==> $text" -ForegroundColor Cyan
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content (Join-Path $root '.node-version') -Raw).Trim().TrimStart('v')
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
$name = "node-v$version-win-$arch"
$tools = Join-Path $root '.tools'
$nodeDir = Join-Path $tools $name
$nodeExe = Join-Path $nodeDir 'node.exe'

if (-not (Test-Path $nodeExe)) {
  Step "Pobieranie Node.js $version ($arch) tylko dla tego projektu – jednorazowo, ok. 35 MB"
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  $base = "https://nodejs.org/dist/v$version"
  $zip = Join-Path $tools "$name.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$name.zip" -OutFile $zip
  $sums = [string](Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
  $line = $sums -split "`r?`n" | Where-Object { $_ -match ('\s' + [regex]::Escape("$name.zip") + '\s*$') } | Select-Object -First 1
  $expected = if ($line) { ($line -split '\s+')[0].ToLowerInvariant() } else { '' }
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
  if (-not $expected -or $actual -ne $expected) {
    Remove-Item $zip -Force
    throw "Suma kontrolna pobranego Node.js się nie zgadza (oczekiwano $expected, jest $actual) – przerwano."
  }
  Write-Host "Suma SHA-256 zgodna z nodejs.org."
  # tar.exe (Windows 10 1803+) unpacks much faster than Expand-Archive.
  if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    & tar.exe -xf $zip -C $tools
    if ($LASTEXITCODE -ne 0) { throw "Nie udało się rozpakować $zip." }
  } else {
    Expand-Archive -Path $zip -DestinationPath $tools -Force
  }
  Remove-Item $zip -Force
  if (-not (Test-Path $nodeExe)) { throw "Po rozpakowaniu brak $nodeExe." }
}

# This process only: the pinned Node.js goes first on PATH, so npm scripts (electron-builder, vitest) use it too.
$env:Path = "$nodeDir;$env:Path"
$npm = Join-Path $nodeDir 'npm.cmd'

function Invoke-Npm([string]$what, [string[]]$npmArgs) {
  Step $what
  & $npm @npmArgs
  if ($LASTEXITCODE -ne 0) { throw "$what – błąd (kod $LASTEXITCODE). Szczegóły powyżej." }
}

Write-Host "Node.js $(& $nodeExe -v), npm $(& $npm -v) (z folderu .tools – systemowy Node nie jest używany)"
Invoke-Npm 'Instalacja zależności (npm ci)' @('ci')
if (-not $SkipTests) { Invoke-Npm 'Testy (npm test)' @('test') }
Invoke-Npm 'Budowanie plików .exe (npm run dist:win)' @('run', 'dist:win')

Step 'Gotowe – pliki w folderze release:'
Get-ChildItem (Join-Path $root 'release') -Filter '*.exe' | ForEach-Object {
  Write-Host ("  {0}  ({1} MB)" -f $_.FullName, [math]::Round($_.Length / 1MB))
}
