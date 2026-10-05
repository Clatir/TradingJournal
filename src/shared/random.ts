/** getRandomValues fills at most 65 536 bytes per call. */
const CHUNK = 16384

/**
 * `n` uniform numbers in [0, 1) with 53 random bits each, from the system's cryptographic generator
 * (`crypto.getRandomValues`, never Math.random). Works in the renderer, the main process and in tests.
 */
export function drawUniforms(n: number): number[] {
  const words = new Uint32Array(n * 2)
  for (let i = 0; i < words.length; i += CHUNK) globalThis.crypto.getRandomValues(words.subarray(i, Math.min(i + CHUNK, words.length)))
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = (words[2 * i]! * 2097152 + (words[2 * i + 1]! >>> 11)) / 9007199254740992
  return out
}
