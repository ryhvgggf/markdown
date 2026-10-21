import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { ServicesProvider } from '@/app/services-context'
import type { AppServices } from '@/app/bootstrap'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { NoteEditor } from './NoteEditor'
import { TitleBlock } from './TitleBlock'

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

  it('does not commit Enter during IME composition', () => {
    render(wrap(<TitleBlock noteId={noteId} />))
    fireEvent.change(title(), { target: { value: 'Composing' } })
    fireEvent.keyDown(title(), { key: 'Enter', keyCode: 229 })
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
