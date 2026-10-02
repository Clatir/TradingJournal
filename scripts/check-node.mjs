// Node.js version gate, run from npm lifecycle scripts (preinstall, predev, prebuild, pretest, prestart).
// The toolchain needs require() of ES modules (on by default since Node 22.12): electron-builder 26
// requires the ESM-only @noble/hashes 2, Electron's on-demand binary installer requires the ESM-only
// @electron/get, Vitest/Vite require std-env. On older Node they fail with a cryptic ERR_REQUIRE_ESM
// (or "Electron failed to install correctly"), so stop early with instructions instead.
// Plain JS without modern syntax on purpose, so the message itself works on any old Node.
const parts = process.versions.node.split('.').map(Number)
const versionOk = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 12)
const flag = process.features && process.features.require_module
const requireEsm = flag === undefined ? versionOk : flag === true

if (!requireEsm) {
  console.error(
    [
      '',
      `BŁĄD: Node.js v${process.versions.node} jest za stary dla tego projektu (wymagany 22.12 lub nowszy, zalecany 24 LTS).`,
      'Na starszym Node testy, tryb deweloperski i budowanie pliku .exe kończą się błędem ERR_REQUIRE_ESM.',
      '',
      'Najprościej (Windows): uruchom build-windows.cmd z folderu projektu – sam pobierze właściwą wersję',
      'Node.js tylko dla tego projektu i zbuduje pliki .exe. Twojego Node.js nie trzeba zmieniać.',
      '',
      'Albo zaktualizuj Node.js: instalator LTS z https://nodejs.org/ lub w PowerShell: winget install OpenJS.NodeJS.LTS',
      '(nvm-windows: nvm install 24, potem nvm use 24), zamknij i otwórz terminal, sprawdź `node -v`, uruchom `npm ci`.',
      ''
    ].join('\n')
  )
  process.exit(1)
}
