// Runs before `npm test`, `npm run build` and `npm run dev`. It only warns: the configs are
// ES modules (.mts), so the toolchain also starts on older Node, but Vite 7 / Vitest 5 officially
// need Node 22.12+ (the first 22.x with require() of ES modules enabled by default).
// Plain JS without modern syntax on purpose, so the warning itself works on any old Node.
const parts = process.versions.node.split('.').map(Number)
const major = parts[0]
const minor = parts[1]
const supported = major > 22 || (major === 22 && minor >= 12)

if (!supported) {
  console.warn(
    [
      '',
      `UWAGA: Node.js v${process.versions.node} jest starszy niż wymagany (22.12 lub nowszy, zalecany 24 LTS).`,
      'Narzędzia budowania (Vite, Vitest, electron-vite) mogą na nim działać niepoprawnie.',
      'Aktualizacja: https://nodejs.org/ (wersja LTS) albo w PowerShell: winget install OpenJS.NodeJS.LTS',
      'Potem zamknij i otwórz terminal na nowo, sprawdź `node -v` i uruchom ponownie `npm ci`.',
      ''
    ].join('\n')
  )
}
