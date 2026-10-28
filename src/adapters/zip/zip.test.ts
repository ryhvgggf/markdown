import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import type { FileEntry } from '@/core/markdown/types'
import { readZip, writeZip } from './zip'

async function* gen(entries: FileEntry[]) {
  yield* entries
}
const bytes = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()))

describe('zip', () => {
  it('round-trips text and binary entries with CJK paths', async () => {
    const blob = await writeZip(
      gen([
        { path: '資料夾/筆記.md', text: '# 標題\n' },
        { path: '空.md', text: '' },
        { path: '附件/圖.png', blob: new Blob([new Uint8Array([0, 1, 2, 255])]) },
        { path: '.notes-v2.json', text: '{"a":1}' },
      ]),
    )
    const out = await readZip(blob)
    const by = new Map(out.map((e) => [e.path, e]))
    expect([...by.keys()].sort()).toEqual(['.notes-v2.json', '空.md', '資料夾/筆記.md', '附件/圖.png'])
    expect(by.get('資料夾/筆記.md')!.text).toBe('# 標題\n')
    expect(by.get('空.md')!.text).toBe('')
    expect(by.get('.notes-v2.json')!.text).toBe('{"a":1}')
    expect(await bytes(by.get('附件/圖.png')!.blob!)).toEqual([0, 1, 2, 255])
  })

  it('drops OS junk and keeps paths inside the root', async () => {
    const raw = zipSync({
      '__MACOSX/a.md': strToU8('x'),
      '.DS_Store': strToU8('x'),
      '../x.md': strToU8('x'),
      '/abs/y.md': strToU8('y'),
      'dir/': new Uint8Array(),
    })
    const out = await readZip(new Blob([raw]))
    expect(out.map((e) => e.path).sort()).toEqual(['abs/y.md', 'x.md'])
  })

  it('writes the entry time (fflate does not read it back; import takes times from the manifest)', async () => {
    const t = new Date(2026, 0, 2, 3, 4, 6).getTime()
    const raw = new Uint8Array(await (await writeZip(gen([{ path: 'a.md', text: 'a', mtime: t }]))).arrayBuffer())
    // DOS time/date of the local file header (offset 10): 03:04:06 on 2026-01-02.
    const dosTime = raw[10] | (raw[11] << 8)
    const dosDate = raw[12] | (raw[13] << 8)
    expect([dosTime >> 11, (dosTime >> 5) & 63, (dosTime & 31) * 2]).toEqual([3, 4, 6])
    expect([(dosDate >> 9) + 1980, (dosDate >> 5) & 15, dosDate & 31]).toEqual([2026, 1, 2])
  })
})
