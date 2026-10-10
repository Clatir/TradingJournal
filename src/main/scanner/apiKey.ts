/**
 * EODHD API key: entered in Settings → Skaner, stored encrypted with Electron safeStorage (DPAPI on Windows) in
 * userData/scanner/key.bin – never in the synced journal folder, never in logs. Where encryption is unavailable
 * (some Linux desktops) the key is kept for the session only. EODHD_API_TOKEN in the environment overrides it
 * (development and tests).
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../datastore/atomic'
import type { KeySource, KeyState } from '@shared/scanner/api'

export interface KeyCrypto {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export type { KeySource, KeyState }

export const API_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/

export function maskKey(key: string): string {
  return key.length <= 8 ? '****' : `${key.slice(0, 4)}…${key.slice(-4)}`
}

export class ApiKeyStore {
  private key: string | null = null
  private source: KeySource | null = null

  constructor(
    private readonly path: string,
    private readonly crypto: KeyCrypto,
    private readonly envToken: string | undefined = undefined
  ) {}

  async load(): Promise<void> {
    const env = this.envToken?.trim()
    if (env) {
      this.key = env
      this.source = 'env'
      return
    }
    try {
      if (!this.crypto.available()) return
      const key = this.crypto.decrypt(await fs.readFile(this.path)).trim()
      if (API_KEY_PATTERN.test(key)) {
        this.key = key
        this.source = 'stored'
      }
    } catch {
      // No key yet or it cannot be decrypted (another Windows user / machine): ask again.
    }
  }

  get(): string | null {
    return this.key
  }

  state(): KeyState {
    return {
      present: !!this.key,
      source: this.source,
      masked: this.key ? maskKey(this.key) : null,
      persisted: this.source === 'env' || this.source === 'stored'
    }
  }

  async set(raw: string): Promise<KeyState> {
    const key = raw.trim()
    if (!API_KEY_PATTERN.test(key)) throw new Error('Klucz API ma nieprawidłowy format (litery, cyfry, kropka, myślnik; 8–128 znaków).')
    this.key = key
    if (this.crypto.available()) {
      await fs.mkdir(dirname(this.path), { recursive: true })
      await writeFileAtomic(this.path, this.crypto.encrypt(key))
      this.source = 'stored'
    } else {
      this.source = 'session'
    }
    return this.state()
  }

  async clear(): Promise<KeyState> {
    this.key = null
    this.source = null
    await fs.rm(this.path, { force: true })
    return this.state()
  }
}
