import { monotonicFactory, ulid } from 'ulid'

const monotonic = monotonicFactory()

/** Globally unique, time-sortable identifier (ULID). Never use counters: records are created on several machines. */
export function newId(): string {
  return monotonic()
}

/** ULID with an explicit timestamp (sample data, imports). */
export function idAt(timeMs: number): string {
  return ulid(timeMs)
}
