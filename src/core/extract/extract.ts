import * as Y from 'yjs'

export type ExtractedBlock = { id: string; type: string; text: string }
export type ExtractedLink = {
  sourceBlockId: string
  targetNoteId: string
  targetBlockId: string | null
  snippet: string
}

const SNIPPET_LENGTH = 80

type XmlChild = Y.XmlElement | Y.XmlText | Y.XmlHook
type Parent = Y.XmlFragment | Y.XmlElement

function isElement(n: unknown): n is Y.XmlElement {
  return n instanceof Y.XmlElement
}
function isText(n: unknown): n is Y.XmlText {
  return n instanceof Y.XmlText
}
function isInlineNode(n: XmlChild): boolean {
  return isText(n) || (isElement(n) && (n.nodeName === 'noteLink' || n.nodeName === 'tag'))
}

function plainText(t: Y.XmlText): string {
  return t
    .toDelta()
    .map((op: { insert?: unknown }) => (typeof op.insert === 'string' ? op.insert : ''))
    .join('')
}

/** Own text of an element: its direct XmlText pieces, plus `#name` for tags. */
function ownText(el: Parent): string {
  let out = ''
  for (const c of el.toArray() as XmlChild[]) {
    if (isText(c)) out += plainText(c)
    else if (isElement(c) && c.nodeName === 'tag') out += `#${c.getAttribute('name') ?? ''}`
  }
  return out
}

export function extractNote(content: Y.XmlFragment): {
  text: string
  blocks: ExtractedBlock[]
  links: ExtractedLink[]
  tags: string[]
  attachmentIds: string[]
} {
  const blocks: ExtractedBlock[] = []
  const links: ExtractedLink[] = []
  const textLines: string[] = []
  const tags: string[] = []
  const attachmentIds: string[] = []

  const walk = (parent: Parent, blockId: string, blockText: string): void => {
    for (const child of parent.toArray() as XmlChild[]) {
      if (!isElement(child)) continue
      switch (child.nodeName) {
        case 'noteLink': {
          const noteId = child.getAttribute('noteId')
          if (!noteId) break
          links.push({
            sourceBlockId: blockId,
            targetNoteId: noteId,
            targetBlockId: child.getAttribute('blockId') ?? null,
            snippet: blockText.slice(0, SNIPPET_LENGTH),
          })
          break
        }
        case 'tag': {
          const name = child.getAttribute('name')
          if (name) {
            const lower = name.toLowerCase()
            if (!tags.includes(lower)) tags.push(lower)
          }
          break
        }
        default: {
          const id = child.getAttribute('id')
          const children = child.toArray() as XmlChild[]
          const isTextblock = children.some(isInlineNode)
          const text = ownText(child)
          if (id) blocks.push({ id, type: child.nodeName, text })
          if (isTextblock) textLines.push(text)
          if (child.nodeName === 'media') {
            const att = child.getAttribute('attachmentId')
            if (att && !attachmentIds.includes(att)) attachmentIds.push(att)
          }
          walk(child, id || blockId, isTextblock || id ? text : blockText)
        }
      }
    }
  }

  walk(content, '', '')
  return { text: textLines.join('\n'), blocks, links, tags, attachmentIds }
}
