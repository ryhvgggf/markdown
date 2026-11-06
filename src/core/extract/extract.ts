import * as Y from 'yjs'

export type ExtractedBlock = { id: string; type: string; text: string }
export type ExtractedLink = {
  sourceBlockId: string
  targetNoteId: string
  targetBlockId: string | null
  snippet: string
}

const SNIPPET_LENGTH = 80
/**
 * Invisible-separator-delimited marker standing in for a noteLink inside a link snippet:
 * `link:<noteId>` or, for a block link, `link:<noteId>#<blockId>` (index version 3; older rows lack the block part).
 */
export const LINK_SENTINEL = '\u2063'
export const linkToken = (noteId: string, blockId?: string | null) =>
  `${LINK_SENTINEL}link:${noteId}${blockId ? `#${blockId}` : ''}${LINK_SENTINEL}`
/** Groups: 1 = note id, 2 = block id (undefined for a note link or an old token). */
export const LINK_TOKEN_RE = new RegExp(`${LINK_SENTINEL}link:([^${LINK_SENTINEL}#]*)(?:#([^${LINK_SENTINEL}]*))?${LINK_SENTINEL}`, 'g')

type XmlChild = Y.XmlElement | Y.XmlText | Y.XmlHook
type Parent = Y.XmlFragment | Y.XmlElement

function isElement(n: unknown): n is Y.XmlElement {
  return n instanceof Y.XmlElement
}
function isText(n: unknown): n is Y.XmlText {
  return n instanceof Y.XmlText
}
function isInlineNode(n: XmlChild): boolean {
  return isText(n) || (isElement(n) && (n.nodeName === 'noteLink' || n.nodeName === 'tag' || n.nodeName === 'mathInline'))
}

function plainText(t: Y.XmlText): string {
  return t
    .toDelta()
    .map((op: { insert?: unknown }) => (typeof op.insert === 'string' ? op.insert : ''))
    .join('')
}

/** A formula's text (phase 5): searchable and shown in snippets as written. */
const latexOf = (el: Y.XmlElement): string => {
  const v = el.getAttribute('latex') as unknown
  return typeof v === 'string' ? v : ''
}

/** Own text of an element: its direct XmlText pieces, plus `#name` for tags and the text of inline formulas. */
function ownText(el: Parent): string {
  let out = ''
  for (const c of el.toArray() as XmlChild[]) {
    if (isText(c)) out += plainText(c)
    else if (isElement(c) && c.nodeName === 'tag') out += `#${c.getAttribute('name') ?? ''}`
    else if (isElement(c) && c.nodeName === 'mathInline') out += latexOf(c)
  }
  return out
}

const LINK_TOKEN_BUDGET = 8

/**
 * Own text like `ownText`, but noteLinks become tokens; cut to SNIPPET_LENGTH *visible* characters without
 * splitting a token or a surrogate pair. A token is rendered as a note title, so it costs LINK_TOKEN_BUDGET,
 * not its length (a block-link token is ~50 characters of ids).
 */
function snippetText(el: Parent): string {
  let out = ''
  let used = 0
  for (const c of el.toArray() as XmlChild[]) {
    let piece = ''
    if (isText(c)) piece = plainText(c)
    else if (isElement(c) && c.nodeName === 'tag') piece = `#${c.getAttribute('name') ?? ''}`
    else if (isElement(c) && c.nodeName === 'mathInline') piece = latexOf(c)
    else if (isElement(c) && c.nodeName === 'noteLink') {
      const id = c.getAttribute('noteId')
      if (id) {
        if (used + LINK_TOKEN_BUDGET > SNIPPET_LENGTH) return out
        out += linkToken(id, c.getAttribute('blockId'))
        used += LINK_TOKEN_BUDGET
      }
      continue
    }
    if (used + piece.length > SNIPPET_LENGTH) {
      let cut = SNIPPET_LENGTH - used
      const code = piece.charCodeAt(cut - 1)
      if (code >= 0xd800 && code <= 0xdbff) cut-- // don't leave half of a surrogate pair
      return out + piece.slice(0, cut)
    }
    out += piece
    used += piece.length
  }
  return out
}

export function extractNote(content: Y.XmlFragment): {
  text: string
  blocks: ExtractedBlock[]
  links: ExtractedLink[]
  tags: string[]
  attachmentIds: string[]
  /** Formulas used (phase 5 graph), deduplicated, compared as written (whitespace counts). */
  formulas: string[]
} {
  const blocks: ExtractedBlock[] = []
  const links: ExtractedLink[] = []
  const textLines: string[] = []
  const tags: string[] = []
  const attachmentIds: string[] = []
  const formulas: string[] = []
  const addFormula = (f: string) => {
    if (f && !formulas.includes(f)) formulas.push(f)
  }

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
            snippet: blockText,
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
        case 'mathInline':
          addFormula(latexOf(child))
          break
        case 'mathBlock': {
          const id = child.getAttribute('id')
          const text = latexOf(child)
          addFormula(text)
          if (id) blocks.push({ id, type: 'mathBlock', text })
          if (text) textLines.push(text)
          break
        }
        default: {
          const id = child.getAttribute('id')
          const children = child.toArray() as XmlChild[]
          const isTextblock = children.some(isInlineNode)
          const text = ownText(child)
          if (id) blocks.push({ id, type: child.nodeName, text })
          if (isTextblock) textLines.push(text)
          // An imported ```math fence counts as a formula (its ends trimmed like an edited formula); other code does not.
          if (child.nodeName === 'codeBlock' && child.getAttribute('language') === 'math') addFormula(text.trim())
          if (child.nodeName === 'media') {
            const att = child.getAttribute('attachmentId')
            if (att && !attachmentIds.includes(att)) attachmentIds.push(att)
          }
          walk(child, id || blockId, isTextblock || id ? snippetText(child) : blockText)
        }
      }
    }
  }

  walk(content, '', '')
  return { text: textLines.join('\n'), blocks, links, tags, attachmentIds, formulas }
}
