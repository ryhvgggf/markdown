import { parseMarkdown } from '@/core/markdown/parse'
import { serializeNote, type SerializeContext } from '@/core/markdown/serialize'
import type { ParseResult, PMNode } from '@/core/markdown/types'

/** SerializeContext as plain data (it crosses to the worker). */
export type SharedContext = {
  titles: Record<string, string>
  /** 'noteId#blockId' → heading text */
  headings: Record<string, string>
  attachments: Record<string, string>
}
/** Per note: the doc and its blocks that need a `^anchor`. */
export type SerializeItem = { doc: PMNode; anchored: string[] }
export type ParseFile = { path: string; text: string; dialect?: 'v1' }

export function toSerializeContext(c: SharedContext, anchored: string[]): SerializeContext {
  return {
    noteTitle: (id) => c.titles[id] ?? null,
    headingText: (n, b) => c.headings[`${n}#${b}`] ?? null,
    attachmentPath: (id) => c.attachments[id] ?? null,
    anchoredBlocks: new Set(anchored),
  }
}

export const serializeItems = (items: SerializeItem[], shared: SharedContext): string[] =>
  items.map((i) => serializeNote(i.doc, toSerializeContext(shared, i.anchored)))
export const parseFiles = (files: ParseFile[]): ParseResult[] => files.map((f) => parseMarkdown(f.text, { dialect: f.dialect }))

export type TransferRequest = { id: number } & ({ op: 'serialize'; items: SerializeItem[]; shared: SharedContext } | { op: 'parse'; files: ParseFile[] })
export type TransferReply = { id: number; result?: unknown; error?: string }
