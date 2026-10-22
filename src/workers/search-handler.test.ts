import { describe, expect, it } from 'vitest'
import { handleRequest, respond, type SearchState } from './search-handler'

const state = (error: string | null): SearchState => ({
  rows: [{ noteId: 'a', title: 't', text: 'hello', updatedAt: 1 }],
  tags: new Map(),
  error,
})

describe('handleRequest', () => {
  it('returns hits when healthy', () => {
    const r = handleRequest(state(null), { id: 1, kind: 'search', query: 'hel' })
    expect('hits' in r && r.hits).toHaveLength(1)
  })
  it('answers searchTags requests', () => {
    const r = handleRequest(state(null), { id: 4, kind: 'searchTags', query: 'zzz' })
    expect(r).toEqual({ id: 4, hits: [] })
  })
  it('replies with an error (not stale hits) while a source is in error', () => {
    expect(handleRequest(state('Search index unavailable: x'), { id: 2, kind: 'search', query: 'hel' })).toEqual({
      id: 2,
      error: 'Search index unavailable: x',
    })
    expect(handleRequest(state('e'), { id: 3, kind: 'mentions', title: 'hel', excludeNoteIds: [] })).toEqual({
      id: 3,
      error: 'e',
    })
  })
})

describe('respond', () => {
  it('replies {id, error} when ready rejects', async () => {
    const r = await respond(state(null), { id: 7, kind: 'search', query: 'x' }, Promise.reject(new Error('db open failed')))
    expect(r).toEqual({ id: 7, error: 'db open failed' })
  })
  it('answers once ready resolves', async () => {
    const r = await respond(state(null), { id: 8, kind: 'search', query: 'hel' }, Promise.resolve())
    expect('hits' in r && r.hits).toHaveLength(1)
  })
})
