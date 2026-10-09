import { z } from 'zod'

/** Current on-disk format version. Bump together with a migration in src/shared/migrations. */
export const SCHEMA_VERSION = 1

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Nieprawidłowy identyfikator (ULID)')

/** ISO 8601 timestamp. Accepts offsets on read; the app always writes UTC ("Z"). */
export const isoDateTime = z.iso.datetime({ offset: true })

/** Calendar date YYYY-MM-DD. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Oczekiwano daty RRRR-MM-DD')

/** Wall clock time HH:MM (24h). */
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Oczekiwano godziny GG:MM')

export const nullableNumber = z.number().finite().nullable().default(null)
export const text = z.string().default('')

export const directionSchema = z.enum(['long', 'short'])
export type Direction = z.infer<typeof directionSchema>

export const annotationSchema = z.looseObject({
  id: ulidSchema,
  type: z.enum(['arrow', 'rect', 'hline', 'text']),
  /** Coordinates normalized to 0..1 of image width/height. */
  x1: z.number(),
  y1: z.number(),
  x2: z.number().default(0),
  y2: z.number().default(0),
  text: text,
  color: z.string().default('#e8a33d'),
  /** Text size relative to the default (text and level labels; 1.6.1). Absent = 1. */
  fontScale: z.number().min(0.25).max(5).optional()
})
export type Annotation = z.infer<typeof annotationSchema>

export const screenPhaseSchema = z.enum(['before', 'during', 'after'])
export type ScreenPhase = z.infer<typeof screenPhaseSchema>

export const screenRefSchema = z.looseObject({
  id: ulidSchema,
  /** Path relative to the data folder, always with forward slashes. */
  path: z.string().min(1),
  thumbPath: z.string().min(1),
  phase: screenPhaseSchema.nullable().default(null),
  timeframe: z.string().nullable().default(null),
  caption: text,
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  annotations: z.array(annotationSchema).default([])
})
export type ScreenRef = z.infer<typeof screenRefSchema>

export const recordBase = {
  schemaVersion: z.number().int(),
  id: ulidSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** Computer that wrote this version (since 1.4.0; null = older file or edited outside the app). */
  updatedBy: z.string().max(200).nullable().optional()
}
