import { describe, expect, it } from 'vitest'
import {
  PORTABLE_ASSET,
  compareVersions,
  detectInstallMode,
  expectedSha256,
  isNewerVersion,
  parseChecksums,
  parseRelease,
  parseVersion,
  pickAsset
} from '@shared/update'
import { encodePowerShell, installerArgs, portableSwapScript, psLiteral } from '../../src/main/update/apply'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function githubRelease(over: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.2.0',
    name: 'ICT Trade Journal 1.2.0',
    body: '## Nowe\r\n- duplikowanie wpisów\r\n',
    published_at: '2026-10-01T10:00:00Z',
    html_url: 'https://github.com/Clatir/TradingJournal/releases/tag/v1.2.0',
    draft: false,
    prerelease: false,
    extra: { kept: true },
    assets: [
      { name: PORTABLE_ASSET, size: 100, browser_download_url: 'https://example.test/p.exe', digest: `sha256:${HASH_A.toUpperCase()}` },
      { name: 'ICT-Trade-Journal-Setup-1.2.0.exe', size: 120, browser_download_url: 'https://example.test/s.exe', digest: null },
      { name: 'ICT-Trade-Journal-Setup-1.2.0.exe.blockmap', size: 5, browser_download_url: 'https://example.test/s.blockmap' },
      { name: 'SHA256SUMS.txt', size: 200, browser_download_url: 'https://example.test/sums' }
    ],
    ...over
  }
}

describe('versions', () => {
  it('parses semver with optional v, pre-release and build metadata', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseVersion('1.2.3-beta.2+build.7')).toEqual({ major: 1, minor: 2, patch: 3, pre: ['beta', '2'] })
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })

  it('orders versions by semver precedence', () => {
    const sorted = ['1.0.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '0.9.9', '1.10.0', '1.2.0']
      .slice()
      .sort(compareVersions)
    expect(sorted).toEqual(['0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.2.0', '1.10.0'])
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true)
    expect(isNewerVersion('v1.1.0', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.1.0-beta.1', '1.1.0')).toBe(false)
    expect(() => compareVersions('x', '1.0.0')).toThrow(/wersji/)
  })
})

describe('GitHub release', () => {
  it('reads the latest release answer', () => {
    const r = parseRelease(githubRelease())
    expect(r.version).toBe('1.2.0')
    expect(r.tag).toBe('v1.2.0')
    expect(r.notes).toBe('## Nowe\n- duplikowanie wpisów')
    expect(r.assets[0]?.sha256).toBe(HASH_A)
    expect(r.assets[1]?.sha256).toBeNull()
  })

  it('rejects answers without a release or a version tag', () => {
    expect(() => parseRelease({ message: 'Not Found' })).toThrow(/GitHub/)
    expect(() => parseRelease(githubRelease({ tag_name: 'nightly' }))).toThrow(/1\.2\.3/)
  })

  it('picks the file matching the installation', () => {
    const r = parseRelease(githubRelease())
    expect(pickAsset(r, 'portable')?.name).toBe(PORTABLE_ASSET)
    expect(pickAsset(r, 'installer')?.name).toBe('ICT-Trade-Journal-Setup-1.2.0.exe')
    expect(pickAsset(r, 'manual')).toBeNull()
    // Older naming (version in the portable name) is still recognised.
    const old = parseRelease(
      githubRelease({ assets: [{ name: 'ICT-Trade-Journal-1.2.0-portable.exe', size: 1, browser_download_url: 'https://example.test/x.exe' }] })
    )
    expect(pickAsset(old, 'portable')?.name).toBe('ICT-Trade-Journal-1.2.0-portable.exe')
    expect(pickAsset(old, 'installer')).toBeNull()
  })

  it('verifies against SHA256SUMS.txt and the GitHub digest', () => {
    const sums = parseChecksums(`${HASH_A}  ${PORTABLE_ASSET}\r\n${HASH_B.toUpperCase()} *ICT-Trade-Journal-Setup-1.2.0.exe\n\nnot a line\n`)
    expect(sums.get('ICT-Trade-Journal-Setup-1.2.0.exe')).toBe(HASH_B)
    const r = parseRelease(githubRelease())
    const portable = pickAsset(r, 'portable')!
    const setup = pickAsset(r, 'installer')!
    expect(expectedSha256(portable, sums)).toBe(HASH_A)
    expect(expectedSha256(portable, null)).toBe(HASH_A) // digest only
    expect(expectedSha256(setup, sums)).toBe(HASH_B) // sums only
    expect(() => expectedSha256(portable, new Map([[PORTABLE_ASSET, HASH_B]]))).toThrow(/nie zgadzają/)
    expect(() => expectedSha256(setup, null)).toThrow(/sumy kontrolnej/)
  })
})

describe('installation mode', () => {
  const base = { platform: 'win32', isPackaged: true, portableFile: undefined, uninstallerExists: false }
  it('recognises portable, installed and manual copies', () => {
    expect(detectInstallMode({ ...base, portableFile: 'D:\\ICT.exe' }).mode).toBe('portable')
    expect(detectInstallMode({ ...base, uninstallerExists: true }).mode).toBe('installer')
    expect(detectInstallMode(base)).toMatchObject({ mode: 'manual', note: expect.stringMatching(/ręcznie/) })
    expect(detectInstallMode({ ...base, isPackaged: false, portableFile: 'x' })).toMatchObject({ mode: 'manual', note: expect.stringMatching(/deweloperska/) })
    expect(detectInstallMode({ ...base, platform: 'linux', uninstallerExists: true }).mode).toBe('manual')
  })
})

describe('applying updates', () => {
  it('quotes PowerShell literals and encodes the script as UTF-16LE base64', () => {
    expect(psLiteral("C:\\Users\\O'Brien\\ICT $x.exe")).toBe("'C:\\Users\\O''Brien\\ICT $x.exe'")
    const script = "Write-Output 'zażółć'"
    expect(Buffer.from(encodePowerShell(script), 'base64').toString('utf16le')).toBe(script)
  })

  it('builds the portable swap script', () => {
    const script = portableSwapScript({
      target: "C:\\Trading\\O'Neil\\ICT-Trade-Journal-portable.exe",
      staged: "C:\\Trading\\O'Neil\\ICT-Trade-Journal-portable.exe.update",
      waitPids: [4242, 0, -1, 1.5, 77],
      restart: true,
      logFile: 'C:\\Users\\x\\AppData\\Roaming\\ICT Trade Journal\\logs\\update.log'
    })
    expect(script).toContain("$target = 'C:\\Trading\\O''Neil\\ICT-Trade-Journal-portable.exe'")
    expect(script).toContain('foreach ($id in @(4242, 77))')
    expect(script).toContain('Start-Process -FilePath $target')
    // The old exe is restored when the new one cannot be moved in.
    expect(script).toMatch(/Move-Item -LiteralPath \$backup -Destination \$target/)
    expect(portableSwapScript({ target: 'a', staged: 'b', waitPids: [1], restart: false, logFile: 'l' })).not.toContain('Start-Process')
    // A briefly locked log file (antivirus, a reader) must not drop lines: errors stop Add-Content and are retried.
    const helper = portableSwapScript({ target: 'a', staged: 'b', waitPids: [1], restart: false, logFile: 'l' })
    expect(helper).toContain('Add-Content -LiteralPath $log -Value $line -Encoding UTF8 -ErrorAction Stop')
    expect(helper).toMatch(/for \(\$t = 0; \$t -lt 20; \$t\+\+\)/)
  })

  it('runs the installer silently into the existing installation', () => {
    expect(installerArgs(false)).toEqual(['--updated', '/S'])
    expect(installerArgs(true)).toEqual(['--updated', '/S', '--force-run'])
  })
})
