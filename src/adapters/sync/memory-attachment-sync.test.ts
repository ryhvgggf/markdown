import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAttachmentSync } from './memory-attachment-sync'

const b = (s: string) => new TextEncoder().encode(s)

let sync: MemoryAttachmentSync
beforeEach(() => {
  sync = new MemoryAttachmentSync()
})

describe('MemoryAttachmentSync', () => {
  it('uploads and downloads an attachment', async () => {
    await sync.uploadAttachment('v1', 'n1', 'a1', b('x'))
    const downloaded = await sync.downloadAttachment('v1', 'a1')
    expect(downloaded && new TextDecoder().decode(downloaded)).toBe('x')
  })

  it('returns null for an attachment that was never uploaded', async () => {
    expect(await sync.downloadAttachment('v1', 'ghost')).toBeNull()
  })

  it('keeps attachments in different vaults separate even with the same id', async () => {
    await sync.uploadAttachment('v1', 'n1', 'a1', b('x'))
    await sync.uploadAttachment('v2', 'n1', 'a1', b('y'))
    expect(new TextDecoder().decode((await sync.downloadAttachment('v1', 'a1'))!)).toBe('x')
    expect(new TextDecoder().decode((await sync.downloadAttachment('v2', 'a1'))!)).toBe('y')
  })

  it('deleteAttachment removes it', async () => {
    await sync.uploadAttachment('v1', 'n1', 'a1', b('x'))
    await sync.deleteAttachment('v1', 'a1')
    expect(await sync.downloadAttachment('v1', 'a1')).toBeNull()
  })

  it('deleteAttachmentsForNote cascades, leaving other notes and vaults untouched', async () => {
    await sync.uploadAttachment('v1', 'n1', 'a1', b('x'))
    await sync.uploadAttachment('v1', 'n1', 'a2', b('y'))
    await sync.uploadAttachment('v1', 'n2', 'a3', b('z'))
    await sync.uploadAttachment('v2', 'n1', 'a4', b('w'))
    await sync.deleteAttachmentsForNote('v1', 'n1')
    expect(await sync.downloadAttachment('v1', 'a1')).toBeNull()
    expect(await sync.downloadAttachment('v1', 'a2')).toBeNull()
    expect(await sync.downloadAttachment('v1', 'a3')).not.toBeNull()
    expect(await sync.downloadAttachment('v2', 'a4')).not.toBeNull()
  })

  it('listAttachments returns only the ids for that note', async () => {
    await sync.uploadAttachment('v1', 'n1', 'a1', b('x'))
    await sync.uploadAttachment('v1', 'n2', 'a2', b('y'))
    expect(await sync.listAttachments('v1', 'n1')).toEqual(['a1'])
  })
})
