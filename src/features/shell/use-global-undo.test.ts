import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { createElement, useEffect, useRef } from 'react'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { useUi } from '@/app/ui-store'
import { Vault } from '@/core/vault/vault'
import { useGlobalUndo } from './use-global-undo'

function fakeVault(overrides: Partial<Vault> = {}): Vault {
  return {
    canUndo: () => true,
    canRedo: () => true,
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  } as unknown as Vault
}

/** Mounts an `<input>` (optionally pre-filled) and an unrelated `<div>`, wires up `useGlobalUndo`, and
 * returns both elements so a test can focus either before dispatching the key. */
function setup(vault: Vault, inputValue = '') {
  let input: HTMLInputElement | null = null
  let outside: HTMLDivElement | null = null
  function Harness() {
    const inputRef = useRef<HTMLInputElement>(null)
    const outsideRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
      input = inputRef.current
      outside = outsideRef.current
    })
    useGlobalUndo(vault)
    return createElement('div', null, createElement('input', { ref: inputRef, defaultValue: inputValue }), createElement('div', { ref: outsideRef, tabIndex: -1 }))
  }
  render(createElement(Harness))
  return { input: input!, outside: outside! }
}

const ctrlZ = () => act(() => void fireEvent.keyDown(window, { key: 'z', ctrlKey: true }))

describe('useGlobalUndo', () => {
  afterEach(() => vi.restoreAllMocks())

  it('falls back to vault.undo() when nothing is focused in an editor (e.g. focus in the sidebar)', () => {
    const vault = fakeVault()
    const { outside } = setup(vault)
    outside.focus()
    ctrlZ()
    expect(vault.undo).toHaveBeenCalledTimes(1)
  })

  it('falls back to vault.undo() when focus is in an EMPTY text input (e.g. a just-created note’s still-blank title) — nothing there for the browser’s native field undo to do', () => {
    const vault = fakeVault()
    const { input } = setup(vault, '')
    input.focus()
    ctrlZ()
    expect(vault.undo).toHaveBeenCalledTimes(1)
  })

  it('leaves it to the browser’s native field undo when the input already has content (e.g. mid-rename) — does not call vault.undo()', () => {
    const vault = fakeVault()
    const { input } = setup(vault, 'Existing title')
    input.focus()
    ctrlZ()
    expect(vault.undo).not.toHaveBeenCalled()
  })

  it('does nothing when there is nothing to undo', () => {
    const vault = fakeVault({ canUndo: () => false })
    const { outside } = setup(vault)
    outside.focus()
    ctrlZ()
    expect(vault.undo).not.toHaveBeenCalled()
  })

  it('when undo removes the currently open note, falls back to another live note instead of leaving the editor stuck on a note that no longer exists', async () => {
    const vault = await Vault.open(new MemoryStorage(), 'v1', {
      channelFactory: () => ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel,
    })
    const earlier = vault.asUserAction(() => vault.createNote({ title: 'Earlier note' }))
    const justCreated = vault.asUserAction(() => vault.createNote({ title: '' }))
    useUi.setState({ openNoteId: justCreated.id })

    const { outside } = setup(vault)
    outside.focus()
    ctrlZ()

    expect(vault.getNote(justCreated.id)).toBeUndefined() // the undo really did remove it
    expect(useUi.getState().openNoteId).toBe(earlier.id) // not left pointing at a note that's gone
  })

  it('when undo removes the currently open note and no other note is left, clears openNoteId (shows the empty-state placeholder) rather than pointing at nothing', async () => {
    const vault = await Vault.open(new MemoryStorage(), 'v1', {
      channelFactory: () => ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel,
    })
    const onlyNote = vault.asUserAction(() => vault.createNote({ title: '' }))
    useUi.setState({ openNoteId: onlyNote.id })

    const { outside } = setup(vault)
    outside.focus()
    ctrlZ()

    expect(useUi.getState().openNoteId).toBeNull()
  })
})
