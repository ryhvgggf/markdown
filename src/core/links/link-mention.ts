import * as Y from 'yjs'

type Parent = Y.XmlFragment | Y.XmlElement
type Op = { insert?: unknown; attributes?: Record<string, unknown> }

/** Text of an XmlText with embeds counted as one placeholder char to keep indexes aligned. */
function indexedText(t: Y.XmlText): string {
  return (t.toDelta() as Op[]).map((op) => (typeof op.insert === 'string' ? op.insert : '￼')).join('')
}

function findAndReplace(parent: Parent, needle: string, targetNoteId: string): boolean {
  const children = parent.toArray()
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child instanceof Y.XmlText) {
      const text = indexedText(child)
      const idx = text.toLowerCase().indexOf(needle)
      if (idx < 0 || text.toLowerCase().length !== text.length) continue
      const end = idx + needle.length
      // Remaining delta after the match, preserving formatting attributes.
      const rest: Op[] = []
      let pos = 0
      for (const op of child.toDelta() as Op[]) {
        const len = typeof op.insert === 'string' ? op.insert.length : 1
        const from = Math.max(end - pos, 0)
        if (pos + len > end) {
          if (typeof op.insert === 'string') {
            rest.push({ insert: op.insert.slice(from), ...(op.attributes ? { attributes: op.attributes } : {}) })
          } else rest.push(op)
        }
        pos += len
      }
      const link = new Y.XmlElement('noteLink')
      link.setAttribute('noteId', targetNoteId)
      const inserted: (Y.XmlElement | Y.XmlText)[] = [link]
      const tail = rest.length > 0 ? new Y.XmlText() : null
      if (tail) inserted.push(tail)
      child.delete(idx, text.length - idx)
      parent.insert(i + 1, inserted)
      if (tail) tail.applyDelta(rest)
      return true
    }
    if (child instanceof Y.XmlElement && child.nodeName !== 'noteLink' && findAndReplace(child, needle, targetNoteId)) {
      return true
    }
  }
  return false
}

/** Replace the first case-insensitive occurrence of `title` in note text with a noteLink atom. */
export function linkMention(content: Y.XmlFragment, title: string, targetNoteId: string): boolean {
  const needle = title.trim().toLowerCase()
  if (!needle) return false
  const run = (): boolean => findAndReplace(content, needle, targetNoteId)
  const doc = content.doc
  if (!doc) return run()
  let done = false
  doc.transact(() => {
    done = run()
  })
  return done
}
