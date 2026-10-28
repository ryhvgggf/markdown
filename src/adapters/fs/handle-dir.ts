import type { Dir, FileStat } from './types'

const split = (path: string) => path.split('/').filter(Boolean)
const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')

/** Dir over a FileSystemDirectoryHandle: a folder the user picked (File System Access) or OPFS. */
export function handleDir(root: FileSystemDirectoryHandle): Dir {
  async function folder(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = root
    for (const p of parts) {
      try {
        d = await d.getDirectoryHandle(p, { create })
      } catch (e) {
        if (!create && isNotFound(e)) return null
        throw e
      }
    }
    return d
  }
  async function file(path: string): Promise<File | null> {
    const parts = split(path)
    const dir = await folder(parts.slice(0, -1), false)
    if (!dir) return null
    try {
      return await (await dir.getFileHandle(parts.at(-1)!)).getFile()
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }
  const stat = (f: File): FileStat => ({ mtime: f.lastModified, size: f.size })

  return {
    async stat(path) {
      const f = await file(path)
      return f ? stat(f) : null
    },
    async read(path) {
      const f = await file(path)
      return f ? { data: f, ...stat(f) } : null
    },
    async write(path, data) {
      const parts = split(path)
      const dir = (await folder(parts.slice(0, -1), true))!
      const h = await dir.getFileHandle(parts.at(-1)!, { create: true })
      const w = await h.createWritable()
      await w.write(data)
      await w.close()
      return stat(await h.getFile())
    },
    async remove(path) {
      const parts = split(path)
      const chain: FileSystemDirectoryHandle[] = [root]
      for (const p of parts.slice(0, -1)) {
        const next = await folder([p], false).catch(() => null)
        const d = next ? await chain.at(-1)!.getDirectoryHandle(p).catch(() => null) : null
        if (!d) return
        chain.push(d)
      }
      try {
        await chain.at(-1)!.removeEntry(parts.at(-1)!)
      } catch (e) {
        if (!isNotFound(e)) throw e
      }
      // Remove folders the delete left empty (never the root).
      for (let i = chain.length - 1; i > 0; i--) {
        const entries = chain[i].values()
        if (!(await entries.next()).done) break
        await chain[i - 1].removeEntry(parts[i - 1])
      }
    },
    async *list() {
      async function* walk(d: FileSystemDirectoryHandle, prefix: string): AsyncGenerator<{ path: string } & FileStat> {
        for await (const [name, h] of d.entries()) {
          if (h.kind === 'directory') yield* walk(h as FileSystemDirectoryHandle, prefix + name + '/')
          else yield { path: prefix + name, ...stat(await (h as FileSystemFileHandle).getFile()) }
        }
      }
      yield* walk(root, '')
    },
  }
}
