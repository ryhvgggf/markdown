import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import type { NotesDb } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import { DIRTY_PREFIX } from '@/core/indexer/indexer'
import type { PMNode } from '@/core/markdown/types'
import type { NoteDocCache } from '@/core/note-doc/cache'
import type { DocIO } from '@/core/transfer/types'
import { createExtensions, type EditorContext } from '@/features/editor/extensions'

let cached: Schema | undefined
/** The editor's schema (built once; no editor or DOM needed). */
export function editorSchema(): Schema {
  return (cached ??= getSchema(createExtensions(new Y.Doc(), { noteId: '' } as unknown as EditorContext)))
}

/** Schema-normalized JSON (default attributes filled in), the same shape `nodeFromJSON(x).toJSON()` gives. */
export const normalizeDoc = (doc: PMNode): PMNode => editorSchema().nodeFromJSON(doc).toJSON() as PMNode
const toJSON = (y: Y.Doc): PMNode => yXmlFragmentToProseMirrorRootNode(y.getXmlFragment('content'), editorSchema()).toJSON() as PMNode

/** Throws when the editor could not open this document. */
function checked(doc: PMNode): PMNode {
  editorSchema().nodeFromJSON(doc).check()
  return doc
}

export function createDocIO(deps: { storage: StorageAdapter; db: NotesDb; notes?: NoteDocCache }): DocIO {
  const { storage, db, notes } = deps
  const markDirty = (noteId: string) => db.meta.put({ key: DIRTY_PREFIX + noteId, value: 1 })
  return {
    async write(noteId, doc) {
      const ydoc = new Y.Doc()
      ydoc.getMap('meta').set('schemaVersion', 1)
      prosemirrorJSONToYXmlFragment(editorSchema(), checked(doc), ydoc.getXmlFragment('content'))
      await storage.appendUpdate(noteId, Y.encodeStateAsUpdate(ydoc))
      ydoc.destroy()
      await markDirty(noteId)
    },

    async replace(noteId, doc) {
      checked(doc)
      if (!notes) throw new Error('replace needs the note cache')
      const ydoc = await notes.acquire(noteId)
      try {
        const frag = ydoc.getXmlFragment('content')
        ydoc.transact(() => {
          frag.delete(0, frag.length)
          prosemirrorJSONToYXmlFragment(editorSchema(), doc, frag)
        })
      } finally {
        notes.release(noteId)
      }
      await markDirty(noteId)
    },

    async read(noteId) {
      const open = notes?.peek(noteId)
      if (open) return toJSON(open)
      const ydoc = new Y.Doc()
      for (const u of await storage.loadDoc(noteId)) Y.applyUpdate(ydoc, u)
      const json = toJSON(ydoc)
      ydoc.destroy()
      return json
    },
  }
}
