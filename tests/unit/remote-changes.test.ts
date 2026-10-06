import { describe, expect, it } from 'vitest'
import { decideRemote, decideRemoteRemoval } from '@shared/remoteChanges'

const base = { id: 'T', updatedAt: '1', notes: 'a', lots: 0.5 }

describe('zmiany z drugiego komputera – decyzja', () => {
  it('bez lokalnych zmian: tryb „scalaj” przyjmuje, tryb „pytaj” pyta; ta sama treść – przyjmij bez pytania', () => {
    const theirs = { ...base, updatedAt: '2', lots: 0.7 }
    expect(decideRemote({ mode: 'merge', dirty: false, base, mine: base, theirs })).toEqual({ action: 'take' })
    expect(decideRemote({ mode: 'ask', dirty: false, base, mine: base, theirs })).toEqual({ action: 'ask', conflicts: [] })
    expect(decideRemote({ mode: 'ask', dirty: false, base, mine: base, theirs: { ...base, updatedAt: '3' } })).toEqual({ action: 'take' })
    // A record this computer does not have yet.
    expect(decideRemote({ mode: 'ask', dirty: false, base: undefined, mine: null, theirs })).toEqual({ action: 'take' })
  })

  it('z lokalnymi zmianami: różne pola – scal; to samo pole – pytaj; identyczna zmiana – nic do zrobienia', () => {
    const mine = { ...base, notes: 'moja' }
    expect(decideRemote({ mode: 'merge', dirty: true, base, mine, theirs: { ...base, updatedAt: '2', lots: 0.7 } })).toEqual({
      action: 'merge',
      merged: { id: 'T', updatedAt: '2', notes: 'moja', lots: 0.7 }
    })
    const conflict = decideRemote({ mode: 'merge', dirty: true, base, mine, theirs: { ...base, notes: 'z B' } })
    expect(conflict.action).toBe('ask')
    expect(conflict.action === 'ask' && conflict.conflicts.map((c) => c.path)).toEqual([['notes']])
    expect(decideRemote({ mode: 'ask', dirty: true, base, mine, theirs: { ...base, lots: 0.7 } }).action).toBe('ask')
    expect(decideRemote({ mode: 'merge', dirty: true, base, mine, theirs: { ...mine, updatedAt: '9' } })).toEqual({ action: 'ignore' })
  })

  it('usunięcie na drugim komputerze', () => {
    expect(decideRemoteRemoval({ mode: 'merge', dirty: false })).toBe('remove')
    expect(decideRemoteRemoval({ mode: 'merge', dirty: true })).toBe('ask')
    expect(decideRemoteRemoval({ mode: 'ask', dirty: false })).toBe('ask')
  })
})
