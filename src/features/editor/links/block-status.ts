import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { liveQuery } from 'dexie'
import type { NotesDb } from '@/adapters/storage/db'

/** How long an indexed note may lack a block row before the block counts as deleted (index lag). */
export const DELETED_BLOCK_GRACE_MS = 2000

/**
 * Text of a linked block, as consumed by `noteLinkLabel`:
 * - `string`: the indexed text
 * - `null`: unknown (loading, index lag, never-indexed note) → render the note title, still clickable
 * - `undefined`: deletion confirmed → 已刪除的區塊
 */
export type BlockTextResult = string | null | undefined

export function docHasBlock(doc: Y.Doc, blockId: string): boolean {
  const walk = (parent: Y.XmlFragment | Y.XmlElement): boolean =>
    parent.toArray().some((c) => c instanceof Y.XmlElement && (c.getAttribute('id') === blockId || walk(c)))
  return walk(doc.getXmlFragment('content'))
}

type Resolved = { key: string; value: BlockTextResult }

/**
 * Live block text from the `blocks` index. A missing row is only "deleted" when confirmed: the target
 * doc is loaded and has no such node, or the note has other index rows and the row is still missing
 * after `DELETED_BLOCK_GRACE_MS`.
 */
export function useBlockText(
  db: NotesDb | undefined,
  noteId: string,
  blockId: string | null,
  peekDoc?: (noteId: string) => Y.Doc | undefined,
): BlockTextResult {
  const key = `${noteId}#${blockId ?? ''}`
  const [result, setResult] = useState<Resolved | null>(null)
  useEffect(() => {
    if (!db || !blockId) return
    let grace: ReturnType<typeof setTimeout> | undefined
    let confirmed = false // grace elapsed with the row still missing
    const stopGrace = () => {
      clearTimeout(grace)
      grace = undefined
      confirmed = false
    }
    const sub = liveQuery(async () => {
      const row = await db.blocks.get([noteId, blockId])
      const indexed = row ? true : (await db.blocks.where('noteId').equals(noteId).count()) > 0
      return { text: row?.text, indexed }
    }).subscribe({
      next: ({ text, indexed }) => {
        if (text !== undefined) {
          stopGrace()
          setResult({ key, value: text })
          return
        }
        const doc = peekDoc?.(noteId)
        if (doc && !docHasBlock(doc, blockId)) {
          stopGrace()
          setResult({ key, value: undefined })
          return
        }
        if (!indexed || doc) stopGrace()
        else if (!grace) {
          grace = setTimeout(() => {
            confirmed = true
            setResult({ key, value: undefined })
          }, DELETED_BLOCK_GRACE_MS)
        }
        setResult({ key, value: confirmed ? undefined : null })
      },
      error: () => setResult({ key, value: null }),
    })
    return () => {
      stopGrace()
      sub.unsubscribe()
    }
  }, [db, noteId, blockId, key, peekDoc])
  if (!blockId) return null
  return result?.key === key ? result.value : null
}
