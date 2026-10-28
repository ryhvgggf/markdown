import { expect, it } from 'vitest'
import type { Dir } from './types'

const text = async (b: Blob) => new TextDecoder().decode(new Uint8Array(await b.arrayBuffer()))

/** Shared behaviour of every Dir implementation (memory in unit tests, OPFS in e2e). */
export function describeDirContract(make: () => Promise<Dir> | Dir) {
  it('writes, stats and reads files, creating folders', async () => {
    const d = await make()
    const st = await d.write('a/b/筆記.md', '內容')
    expect(st.size).toBe(new TextEncoder().encode('內容').length)
    expect(await d.stat('a/b/筆記.md')).toEqual({ mtime: st.mtime, size: st.size })
    const r = await d.read('a/b/筆記.md')
    expect(await text(r!.data)).toBe('內容')
    expect(await d.stat('nope.md')).toBeNull()
    expect(await d.read('a/nope.md')).toBeNull()
  })

  it('overwrites', async () => {
    const d = await make()
    await d.write('x.md', 'one')
    await d.write('x.md', 'three')
    expect(await text((await d.read('x.md'))!.data)).toBe('three')
  })

  it('lists files recursively and removes files and emptied folders', async () => {
    const d = await make()
    await d.write('a/b/1.md', '1')
    await d.write('a/2.md', '2')
    await d.write('3.bin', new Blob([new Uint8Array([1, 2])]))
    const all: string[] = []
    for await (const f of d.list()) all.push(f.path)
    expect(all.sort()).toEqual(['3.bin', 'a/2.md', 'a/b/1.md'])
    await d.remove('a/b/1.md')
    await d.remove('missing.md')
    const left: string[] = []
    for await (const f of d.list()) left.push(f.path)
    expect(left.sort()).toEqual(['3.bin', 'a/2.md'])
    await d.write('a/b/again.md', 'x') // the emptied folder can be created again
    expect(await d.stat('a/b/again.md')).not.toBeNull()
  })
}
