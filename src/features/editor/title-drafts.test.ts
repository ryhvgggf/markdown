import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { Vault } from '@/core/vault/vault'
import { applyTitleDrafts, saveTitleDraft } from './title-drafts'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel
let vault: Vault
beforeEach(async () => {
  localStorage.clear()
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
})
afterEach(() => localStorage.clear())

describe('title drafts', () => {
  it('re-applies a draft whose commit was lost, then forgets it', () => {
    const n = vault.createNote({ title: '' })
    saveTitleDraft(n.id, 'BetaTitle ', '')
    applyTitleDrafts(vault)
    expect(vault.getNote(n.id)?.title).toBe('BetaTitle')
    expect(localStorage.length).toBe(0)
  })

  it('does not override a rename made elsewhere since the edit started', () => {
    const n = vault.createNote({ title: 'Old' })
    saveTitleDraft(n.id, 'Mine', 'Old')
    vault.renameNote(n.id, 'Other tab')
    applyTitleDrafts(vault)
    expect(vault.getNote(n.id)?.title).toBe('Other tab')
  })

  it('skips colliding drafts and drafts of deleted notes', () => {
    vault.createNote({ title: 'Taken' })
    const n = vault.createNote({ title: 'X' })
    saveTitleDraft(n.id, 'taken', 'X')
    saveTitleDraft('gone', 'Whatever', '')
    applyTitleDrafts(vault)
    expect(vault.getNote(n.id)?.title).toBe('X')
    expect(localStorage.length).toBe(0)
  })
})
