import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { ServicesProvider } from '@/app/services-context'
import type { AppServices } from '@/app/bootstrap'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { NoteEditor } from './NoteEditor'
import { TitleBlock } from './TitleBlock'
import { useActiveEditor } from '@/features/panel/active-editor'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let noteId: string
let services: AppServices

beforeEach(async () => {
  const storage = new MemoryStorage()
  vault = await Vault.open(storage, 'v', { channelFactory })
  vault.createNote({ title: 'sap' })
  noteId = vault.createNote({ title: 'Mine' }).id
  const notes = new NoteDocCache(storage, { channelFactory })
  services = { vault, notes, storage, db: {} } as unknown as AppServices
})
afterEach(cleanup)

const wrap = (ui: React.ReactNode) => <ServicesProvider services={services}>{ui}</ServicesProvider>
const title = () => screen.getByLabelText('筆記標題') as HTMLInputElement

describe('TitleBlock', () => {
  it('shows a hint and does not write when the title collides', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    fireEvent.change(title(), { target: { value: 'SAP' } })
    expect(screen.getByText('已有同名筆記')).toBeInTheDocument()
    fireEvent.blur(title())
    expect(vault.getNote(noteId)?.title).toBe('Mine')
  })

  it('commits on blur', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    fireEvent.change(title(), { target: { value: 'Renamed' } })
    expect(vault.getNote(noteId)?.title).toBe('Mine')
    fireEvent.blur(title())
    expect(vault.getNote(noteId)?.title).toBe('Renamed')
  })

  it('shows the 未命名 placeholder when empty', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    fireEvent.change(title(), { target: { value: '' } })
    expect(title()).toHaveAttribute('placeholder', '未命名')
  })

  it('syncs external renames when not focused', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    act(() => vault.renameNote(noteId, 'From elsewhere'))
    expect(title().value).toBe('From elsewhere')
  })

  it('Enter commits and moves focus into the editor', async () => {
    render(
      wrap(
        <>
          <TitleBlock noteId={noteId} />
          <NoteEditor noteId={noteId} />
        </>,
      ),
    )
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    title().focus()
    fireEvent.change(title(), { target: { value: 'Entered' } })
    fireEvent.keyDown(title(), { key: 'Enter' })
    expect(vault.getNote(noteId)?.title).toBe('Entered')
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveFocus())
  })

  it('Enter before the editor has loaded still hands focus over once it mounts', async () => {
    render(
      wrap(
        <>
          <TitleBlock noteId={noteId} />
          <NoteEditor noteId={noteId} />
        </>,
      ),
    )
    expect(document.querySelector('.ProseMirror')).toBeNull()
    title().focus()
    fireEvent.change(title(), { target: { value: 'Early' } })
    fireEvent.keyDown(title(), { key: 'Enter' })
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveFocus())
  })

  it('does not commit Enter during IME composition', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    fireEvent.change(title(), { target: { value: 'Composing' } })
    fireEvent.keyDown(title(), { key: 'Enter', keyCode: 229 })
    expect(vault.getNote(noteId)?.title).toBe('Mine')
  })
})

describe('TitleBlock saving (I3)', () => {
  afterEach(() => vi.useRealTimers())

  it('commits ~500 ms after typing stops, without blur or Enter', () => {
    vi.useFakeTimers()
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.change(title(), { target: { value: 'Beta' } })
    act(() => void vi.advanceTimersByTime(300))
    fireEvent.change(title(), { target: { value: 'BetaTitle' } })
    act(() => void vi.advanceTimersByTime(400))
    expect(vault.getNote(noteId)?.title).toBe('Mine')
    act(() => void vi.advanceTimersByTime(150))
    expect(vault.getNote(noteId)?.title).toBe('BetaTitle')
    expect(title()).toHaveFocus()
  })

  it('keeps a trailing space while typing after a debounced commit', () => {
    vi.useFakeTimers()
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.change(title(), { target: { value: 'hello ' } })
    act(() => void vi.advanceTimersByTime(600))
    expect(vault.getNote(noteId)?.title).toBe('hello')
    expect(title().value).toBe('hello ')
  })

  it('commits on pagehide', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.change(title(), { target: { value: 'Closing' } })
    act(() => void window.dispatchEvent(new Event('pagehide')))
    expect(vault.getNote(noteId)?.title).toBe('Closing')
  })

  it('commits a pending edit when the note is switched away (unmount)', () => {
    const r = render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.change(title(), { target: { value: 'Switched' } })
    r.unmount()
    expect(vault.getNote(noteId)?.title).toBe('Switched')
  })

  it('never commits mid-composition; commits after compositionend', () => {
    vi.useFakeTimers()
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.compositionStart(title())
    fireEvent.change(title(), { target: { value: 'ㄓㄨ' } })
    act(() => void vi.advanceTimersByTime(1000))
    act(() => void window.dispatchEvent(new Event('pagehide')))
    expect(vault.getNote(noteId)?.title).toBe('Mine')
    fireEvent.change(title(), { target: { value: '主題' } })
    fireEvent.compositionEnd(title())
    act(() => void vi.advanceTimersByTime(600))
    expect(vault.getNote(noteId)?.title).toBe('主題')
  })

  it('keeps a reload-safe draft of the typed title, but not of uncommitted composition text', () => {
    localStorage.clear()
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.compositionStart(title())
    fireEvent.change(title(), { target: { value: 'ㄓㄨ' } })
    expect(localStorage.length).toBe(0)
    fireEvent.change(title(), { target: { value: '主題' } })
    fireEvent.compositionEnd(title())
    expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!)).toEqual({ v: '主題', base: 'Mine' })
    localStorage.clear()
  })

  it('drops the reload-safe draft once the commit is stored', async () => {
    localStorage.clear()
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.change(title(), { target: { value: 'Stored' } })
    expect(localStorage.length).toBe(1)
    fireEvent.blur(title())
    await waitFor(() => expect(localStorage.length).toBe(0))
  })

  it('accepts a rename from another tab while focused but unedited, and blur does not revert it', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    act(() => vault.renameNote(noteId, 'Other tab'))
    expect(title().value).toBe('Other tab')
    fireEvent.blur(title())
    expect(vault.getNote(noteId)?.title).toBe('Other tab')
  })

  it('keeps a colliding draft visible with its hint after blur', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    title().focus()
    fireEvent.change(title(), { target: { value: 'sap' } })
    fireEvent.blur(title())
    act(() => vault.touchNote(noteId))
    expect(title().value).toBe('sap')
    expect(screen.getByText('已有同名筆記')).toBeInTheDocument()
    expect(vault.getNote(noteId)?.title).toBe('Mine')
  })
})

describe('ArrowUp in the first block', () => {
  it('moves focus back to the title', async () => {
    render(
      wrap(
        <>
          <TitleBlock noteId={noteId} />
          <NoteEditor noteId={noteId} />
        </>,
      ),
    )
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    const pm = document.querySelector('.ProseMirror') as HTMLElement
    pm.focus()
    fireEvent.keyDown(pm, { key: 'ArrowUp' })
    expect(title()).toHaveFocus()
  })
})

describe('ArrowDown in the title', () => {
  const both = () =>
    render(
      wrap(
        <>
          <TitleBlock noteId={noteId} />
          <NoteEditor noteId={noteId} />
        </>,
      ),
    )

  it('moves the caret to the start of the first body block without creating one', async () => {
    both()
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    const editor = useActiveEditor.getState().editor!
    act(() => void editor.commands.setContent('<p>first</p><p>second</p>'))
    title().focus()
    const notPrevented = fireEvent.keyDown(title(), { key: 'ArrowDown' })
    expect(notPrevented).toBe(false)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveFocus())
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.doc.childCount).toBe(2)
  })

  it('focuses an empty body', async () => {
    both()
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    title().focus()
    fireEvent.keyDown(title(), { key: 'ArrowDown' })
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveFocus())
    expect(useActiveEditor.getState().editor!.state.doc.childCount).toBe(1)
  })

  it('does nothing during IME composition or with modifiers', async () => {
    both()
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    title().focus()
    for (const init of [{ keyCode: 229 }, { isComposing: true }, { shiftKey: true }, { altKey: true }]) {
      expect(fireEvent.keyDown(title(), { key: 'ArrowDown', ...init })).toBe(true)
      expect(title()).toHaveFocus()
    }
  })
})
