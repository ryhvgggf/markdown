import { describe, expect, it } from 'vitest'
import type { NoteTextRow } from '../../adapters/storage/db'
import { findMentions, listTags, searchByTag, searchNotes } from './search'

const row = (noteId: string, title: string, text: string, updatedAt = 1): NoteTextRow => ({
  noteId,
  title,
  text,
  updatedAt,
})
const noTags = new Map<string, string[]>()

describe('searchNotes', () => {
  it('matches Chinese content', () => {
    const hits = searchNotes('購申', [row('a', '標題', '建立採購申請')], noTags)
    expect(hits).toHaveLength(1)
    expect(hits[0].field).toBe('content')
    expect(hits[0].snippet).toContain('購申')
  })

  it('ranks title > tag > content, then updatedAt desc', () => {
    const rows = [
      row('c-old', 'x', 'foo here', 1),
      row('c-new', 'x', 'foo here', 5),
      row('t', 'x', 'nothing', 2),
      row('ti', 'foo', 'nothing', 0),
    ]
    const tags = new Map([['t', ['foobar']]])
    const hits = searchNotes('foo', rows, tags)
    expect(hits.map((h) => h.noteId)).toEqual(['ti', 't', 'c-new', 'c-old'])
    expect(hits.map((h) => h.field)).toEqual(['title', 'tag', 'content', 'content'])
    expect(hits[1].snippet).toBe('#foobar')
  })

  it('is case-insensitive', () => {
    expect(searchNotes('me51n', [row('a', 't', 'use ME51N now')], noTags)).toHaveLength(1)
  })

  it('matches literally', () => {
    const rows = [row('a', 't', 'C++ (ME51N)'), row('b', 't', 'a.b* yes'), row('c', 't', 'axb')]
    expect(searchNotes('C++ (ME51N)', rows, noTags).map((h) => h.noteId)).toEqual(['a'])
    expect(searchNotes('a.b*', rows, noTags).map((h) => h.noteId)).toEqual(['b'])
  })

  it('builds snippets with ellipses', () => {
    const text = 'a'.repeat(50) + 'NEEDLE' + 'b'.repeat(50)
    const [hit] = searchNotes('needle', [row('a', 't', text)], noTags)
    expect(hit.snippet).toBe('…' + 'a'.repeat(30) + 'NEEDLE' + 'b'.repeat(30) + '…')
    const [short] = searchNotes('needle', [row('a', 't', 'xNEEDLEy')], noTags)
    expect(short.snippet).toBe('xNEEDLEy')
  })

  it('title hit snippet is first 60 chars of text', () => {
    const [hit] = searchNotes('ttl', [row('a', 'TTL', 'z'.repeat(70))], noTags)
    expect(hit.snippet).toBe('z'.repeat(60) + '…')
  })

  it('returns [] for blank query and honours limit', () => {
    expect(searchNotes('   ', [row('a', 't', 'x')], noTags)).toEqual([])
    const rows = Array.from({ length: 60 }, (_, i) => row(String(i), 't', 'hit', i))
    expect(searchNotes('hit', rows, noTags)).toHaveLength(50)
    expect(searchNotes('hit', rows, noTags, { limit: 3 })).toHaveLength(3)
  })
})

describe('findMentions', () => {
  const rows = [
    row('self', 'Target', 'Target is mentioned'),
    row('a', 'Other', 'see target here'),
    row('b', 'Target', 'target again'),
    row('c', 'Other', 'unrelated'),
    row('d', 'target', 'title only matches'),
  ]
  it('excludes ids and self, content only', () => {
    expect(findMentions('Target', rows, new Set(['self'])).map((h) => h.noteId)).toEqual(['a'])
    expect(findMentions('Target', rows, new Set(['a'])).map((h) => h.noteId)).toEqual([])
  })
  it('blank title -> []', () => {
    expect(findMentions('  ', rows, new Set())).toEqual([])
  })
})

describe('trashed rows', () => {
  const trashedNewest = (n: number) =>
    Array.from({ length: 60 }, (_, i) => ({ ...row(`x${i}`, `採購${i}`, '採購', 100 + i), trashed: true })).slice(0, n)
  it('searchNotes skips trashed rows before the 50 cap', () => {
    const rows = [...trashedNewest(60), row('live', '採購', 'x', 1)]
    expect(searchNotes('採購', rows, noTags).map((h) => h.noteId)).toEqual(['live'])
  })
  it('searchByTag skips trashed rows before the cap', () => {
    const rows = [...trashedNewest(60), row('live', 'z', 'x', 1)]
    const tags = new Map(rows.map((r) => [r.noteId, ['採購']]))
    expect(searchByTag('採購', rows, tags).map((h) => h.noteId)).toEqual(['live'])
  })
  it('findMentions skips trashed rows', () => {
    const rows = [{ ...row('t', 'A', 'see target'), trashed: true }, row('l', 'B', 'see target')]
    expect(findMentions('target', rows, new Set()).map((h) => h.noteId)).toEqual(['l'])
  })
})

describe('listTags', () => {
  it('counts each tag across untrashed notes, most-used first, ties alphabetical', () => {
    const rows = [row('a', 'A', 'x', 1), row('b', 'B', 'x', 2), row('c', 'C', 'x', 3)]
    const tags = new Map([
      ['a', ['採購', '財務']],
      ['b', ['採購']],
      ['c', ['Zebra', '財務']],
    ])
    expect(listTags(rows, tags)).toEqual([
      { tag: '採購', count: 2 },
      { tag: '財務', count: 2 },
      { tag: 'Zebra', count: 1 },
    ])
  })
  it('ignores tags on trashed notes', () => {
    const rows = [row('a', 'A', 'x', 1), { ...row('b', 'B', 'x', 2), trashed: true }]
    const tags = new Map([['a', ['採購']], ['b', ['財務']]])
    expect(listTags(rows, tags)).toEqual([{ tag: '採購', count: 1 }])
  })
  it('is empty when nothing is tagged', () => {
    expect(listTags([row('a', 'A', 'x', 1)], noTags)).toEqual([])
  })
})

describe('searchByTag', () => {
  it('finds a tagged note even when its title also matches, and beyond 50 title matches', () => {
    const rows = [
      row('tagged', '採購單', 'x', 1),
      ...Array.from({ length: 60 }, (_, i) => row(`t${i}`, `採購${i}`, 'x', 10 + i)),
      row('other', 'z', 'y', 3),
    ]
    const tags = new Map([['tagged', ['採購']], ['other', ['財務', 'Procure-X']]])
    const hits = searchByTag('採購', rows, tags)
    expect(hits).toEqual([{ noteId: 'tagged', title: '採購單', field: 'tag', snippet: '#採購', updatedAt: 1 }])
    expect(searchByTag('#procure', rows, tags)[0]).toMatchObject({ noteId: 'other', snippet: '#Procure-X' })
  })
  it('sorts by updatedAt desc, limits to 50, blank -> []', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`n${i}`, 't', 'x', i))
    const tags = new Map(rows.map((r) => [r.noteId, ['a']]))
    const hits = searchByTag('a', rows, tags)
    expect(hits).toHaveLength(50)
    expect(hits[0].noteId).toBe('n59')
    expect(searchByTag('#', rows, tags)).toEqual([])
  })
})
