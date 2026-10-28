import { describe, expect, it } from 'vitest'
import { assignBlockIds, BLOCK_TYPES } from './blocks'
import type { PMNode } from './markdown/types'

let n = 0
const gen = () => `g${++n}`

describe('assignBlockIds', () => {
  it('fills missing ids on block types only, keeps existing ids', () => {
    n = 0
    const doc: PMNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'heading', attrs: { level: 1, id: 'keep' }, content: [{ type: 'text', text: 'h' }] },
      ],
    }
    const out = assignBlockIds(doc, BLOCK_TYPES, gen)
    expect(out.attrs?.id).toBeUndefined()
    expect(out.content![0].attrs?.id).toBe('g1')
    expect(out.content![1].attrs).toEqual({ level: 1, id: 'keep' })
    expect(out.content![0].content![0].attrs).toBeUndefined()
  })

  it('replaces a repeated id with a fresh one', () => {
    n = 0
    const doc: PMNode = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'x' } }, { type: 'paragraph', attrs: { id: 'x' } }] }
    const out = assignBlockIds(doc, BLOCK_TYPES, gen)
    expect(out.content!.map((c) => c.attrs?.id)).toEqual(['x', 'g1'])
  })

  it('defaults to BLOCK_TYPES and newId', () => {
    const out = assignBlockIds({ type: 'doc', content: [{ type: 'media', attrs: { attachmentId: 'a' } }] })
    expect(out.content![0].attrs?.id).toEqual(expect.any(String))
  })
})
