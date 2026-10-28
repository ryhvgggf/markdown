import type { PMNode } from '@/core/markdown/types'
import type { DocIO } from '../types'

/** DocIO test double: documents kept as JSON. `failOn` makes the n-th write (1-based) throw once. */
export function memoryDocIO(opts: { failOn?: number } = {}): DocIO & { docs: Map<string, PMNode>; writes: number } {
  const docs = new Map<string, PMNode>()
  const io = {
    docs,
    writes: 0,
    async write(id: string, doc: PMNode) {
      io.writes++
      if (opts.failOn === io.writes) {
        opts.failOn = undefined
        throw new Error('write failed')
      }
      docs.set(id, doc)
    },
    async replace(id: string, doc: PMNode) {
      docs.set(id, doc)
    },
    async read(id: string) {
      return docs.get(id) ?? { type: 'doc', content: [] }
    },
  }
  return io
}
