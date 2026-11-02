import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { useUi } from '@/app/ui-store'
import { Vault } from '@/core/vault/vault'
import { useEnsureOpenNote } from './use-ensure-open-note'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  useUi.setState({ openNoteId: null })
})
afterEach(() => useUi.setState({ openNoteId: null }))

describe('useEnsureOpenNote', () => {
  it('opens the most recently edited note when notes exist but none is open', () => {
    const a = vault.createNote({ title: 'A', folderId: null })
    const b = vault.createNote({ title: 'B', folderId: null })
    renderHook(() => useEnsureOpenNote(vault))
    const newest = [a, b].map((n) => vault.getNote(n.id)!).sort((x, y) => y.updatedAt - x.updatedAt)[0]
    expect(useUi.getState().openNoteId).toBe(newest.id)
  })

  it('switches to another note when the open one disappears (purged, restored over, removed by another tab)', () => {
    const a = vault.createNote({ title: 'A', folderId: null })
    const b = vault.createNote({ title: 'B', folderId: null })
    useUi.setState({ openNoteId: a.id })
    renderHook(() => useEnsureOpenNote(vault))
    expect(useUi.getState().openNoteId).toBe(a.id)
    act(() => {
      vault.trashNote(a.id)
      vault.purgeNote(a.id)
    })
    expect(useUi.getState().openNoteId).toBe(b.id)
  })

  it('leaves nothing open when the vault has no notes', () => {
    renderHook(() => useEnsureOpenNote(vault))
    expect(useUi.getState().openNoteId).toBeNull()
  })

  it('does not touch a valid open note', () => {
    const a = vault.createNote({ title: 'A', folderId: null })
    vault.createNote({ title: 'B', folderId: null })
    useUi.setState({ openNoteId: a.id })
    renderHook(() => useEnsureOpenNote(vault))
    expect(useUi.getState().openNoteId).toBe(a.id)
  })
})
