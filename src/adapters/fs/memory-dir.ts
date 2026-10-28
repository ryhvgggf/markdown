import type { Dir, FileStat } from './types'

type Entry = { data: string | Blob; mtime: number }

const size = (d: string | Blob) => (typeof d === 'string' ? new TextEncoder().encode(d).length : d.size)

/** In-memory Dir for unit tests; `files` is exposed for assertions and for simulating outside edits. */
export function memoryDir(clock: () => number = Date.now): Dir & { files: Map<string, Entry> } {
  const files = new Map<string, Entry>()
  const stat = (e: Entry): FileStat => ({ mtime: e.mtime, size: size(e.data) })
  return {
    files,
    async stat(path) {
      const e = files.get(path)
      return e ? stat(e) : null
    },
    async read(path) {
      const e = files.get(path)
      return e ? { data: typeof e.data === 'string' ? new Blob([e.data]) : e.data, ...stat(e) } : null
    },
    async write(path, data) {
      const e = { data, mtime: clock() }
      files.set(path, e)
      return stat(e)
    },
    async remove(path) {
      files.delete(path)
    },
    async *list() {
      for (const [path, e] of [...files]) yield { path, ...stat(e) }
    },
  }
}
