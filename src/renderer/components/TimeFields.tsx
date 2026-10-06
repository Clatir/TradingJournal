import { useState } from 'react'
import { DateTime } from 'luxon'
import { formatClock, fromLocal, zoned, type ZoneKey } from '@shared/calc/time'
import { parseClockInput, parseDateInput } from '../lib/format'
import { cx } from './ui'

function DraftInput({
  value,
  onCommit,
  className,
  placeholder,
  width,
  ...rest
}: {
  value: string
  onCommit: (text: string) => boolean
  className?: string
  placeholder?: string
  width: number
  'aria-label'?: string
  'data-testid'?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const commit = () => {
    if (draft == null) return
    const ok = onCommit(draft)
    setInvalid(!ok)
    if (ok) setDraft(null)
  }
  return (
    <input
      className={cx('input num px-1.5 text-center', className)}
      style={{ width }}
      value={draft ?? value}
      placeholder={placeholder}
      spellCheck={false}
      aria-invalid={invalid}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.currentTarget.value)
        setInvalid(false)
      }}
      onBlur={() => {
        commit()
        setDraft(null)
        setInvalid(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setDraft(null)
          setInvalid(false)
        }
      }}
      {...rest}
    />
  )
}

const ZONE_LABEL: Record<ZoneKey, string> = { NY: 'NY', WAW: 'WAW', UTC: 'UTC' }

/**
 * Entry time edited in New York or Warsaw time (both visible, both editable); stored as UTC.
 * Warns about wall times that do not exist or occur twice because of DST.
 */
export function DualTimeField({
  iso,
  onChange,
  primary = 'NY',
  testId
}: {
  iso: string
  onChange: (iso: string) => void
  primary?: 'NY' | 'WAW'
  testId?: string
}) {
  const [warning, setWarning] = useState<string | null>(null)
  const zones: Array<'NY' | 'WAW'> = primary === 'NY' ? ['NY', 'WAW'] : ['WAW', 'NY']

  const apply = (zone: 'NY' | 'WAW', date: string, time: string): boolean => {
    const res = fromLocal(date, time, zone)
    if (!res) return false
    setWarning(
      res.nonexistent
        ? `Godzina ${time} nie istnieje w strefie ${ZONE_LABEL[zone]} (zmiana czasu) – przesunięto.`
        : res.ambiguous
          ? `Godzina ${time} występuje dwukrotnie w strefie ${ZONE_LABEL[zone]} – przyjęto wcześniejszą.`
          : null
    )
    onChange(res.iso)
    return true
  }

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      {zones.map((zone) => {
        const local = zoned(iso, zone)
        const date = local.toISODate() ?? ''
        const time = local.toFormat('HH:mm')
        return (
          <div key={zone} className="flex items-center gap-1">
            <span className={cx('w-[30px] text-[10.5px] font-medium tracking-wide', zone === primary ? 'text-accent' : 'text-muted')}>
              {ZONE_LABEL[zone]}
            </span>
            <DraftInput
              width={92}
              value={date}
              aria-label={`Data ${ZONE_LABEL[zone]}`}
              data-testid={testId ? `${testId}-${zone}-date` : undefined}
              onCommit={(t) => {
                const d = parseDateInput(t, local.year)
                return d ? apply(zone, d, time) : false
              }}
            />
            <DraftInput
              width={54}
              value={time}
              aria-label={`Godzina ${ZONE_LABEL[zone]}`}
              data-testid={testId ? `${testId}-${zone}-time` : undefined}
              onCommit={(t) => {
                const c = parseClockInput(t)
                return c ? apply(zone, date, c) : false
              }}
            />
            <span className="ml-1 text-[11px] text-dim">{local.toFormat('ccc', { locale: 'pl' })}</span>
          </div>
        )
      })}
      {warning && <div className="text-[11px] text-accent">{warning}</div>}
    </div>
  )
}

/**
 * Exit time typed as HH:MM in New York or Warsaw time relative to the entry: the date follows the entry day in that
 * zone, rolling to the next day when the time is earlier than the entry.
 */
export function ExitClockField({
  iso,
  referenceIso,
  onChange,
  zone = 'NY',
  width = 54,
  testId
}: {
  iso: string | null
  referenceIso: string
  onChange: (iso: string | null) => void
  zone?: 'NY' | 'WAW'
  width?: number
  testId?: string
}) {
  const value = iso ? formatClock(iso, zone) : ''
  const nextDay = iso && zoned(iso, zone).toISODate() !== zoned(referenceIso, zone).toISODate()
  const title = iso ? `NY ${zoned(iso, 'NY').toFormat('yyyy-MM-dd HH:mm')} · WAW ${zoned(iso, 'WAW').toFormat('yyyy-MM-dd HH:mm')}` : `Godzina wyjścia (${ZONE_LABEL[zone]})`
  return (
    <span title={title} className="relative">
      <DraftInput
        width={width}
        value={value}
        placeholder={ZONE_LABEL[zone]}
        aria-label={`Godzina wyjścia ${ZONE_LABEL[zone]}`}
        data-testid={testId}
        onCommit={(t) => {
          if (t.trim() === '') {
            onChange(null)
            return true
          }
          const c = parseClockInput(t)
          if (!c) return false
          const refDate = zoned(referenceIso, zone).toISODate() ?? ''
          let res = fromLocal(refDate, c, zone)
          if (res && Date.parse(res.iso) < Date.parse(referenceIso)) {
            const next = DateTime.fromISO(refDate).plus({ days: 1 }).toISODate() ?? refDate
            res = fromLocal(next, c, zone)
          }
          if (!res) return false
          onChange(res.iso)
          return true
        }}
      />
      {nextDay && <span className="pointer-events-none absolute -top-1 right-0.5 text-[9px] text-accent">+1</span>}
    </span>
  )
}
