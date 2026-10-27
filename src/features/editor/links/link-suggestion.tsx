import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionMatch, type Trigger } from '@tiptap/suggestion'
import type { NoteMeta } from '@/core/vault/types'
import type { Vault } from '@/core/vault/vault'
import { displayTitle, normalizeTitle } from '@/core/vault/titles'
import type { EditorContext } from '../extensions'
import { suggestionPopup, type PopupListHandle } from '../menus/suggestion-popup'
import type { LinkTarget } from './block-link-clipboard'

export type LinkItem =
  | { kind: 'note'; id: string; title: string; path: string }
  | { kind: 'create'; title: string }
  | { kind: 'block'; noteId: string; blockId: string; type: string; text: string }

const MAX_ITEMS = 8
const MAX_QUERY = 100

export const TYPE_BADGES: Record<string, string> = {
  paragraph: '段落', heading: '標題', listItem: '清單', taskItem: '待辦', blockquote: '引用', callout: '提示框',
  codeBlock: '程式碼', table: '表格', bulletList: '清單', orderedList: '清單', taskList: '待辦',
}

/** `[[query` before the caret: last unclosed `[[` in the text node, spaces allowed, no newline. */
export function findLinkQuery({ $position }: Trigger): SuggestionMatch {
  const text = $position.nodeBefore?.isText ? ($position.nodeBefore.text ?? '') : ''
  const idx = text.lastIndexOf('[[')
  if (idx < 0) return null
  const query = text.slice(idx + 2)
  if (query.includes(']]') || query.includes('\n') || query.length > MAX_QUERY || /^\s|\s{2}/.test(query)) return null
  const from = $position.pos - text.length + idx
  return { range: { from, to: $position.pos }, query, text: text.slice(idx) }
}

function folderPath(vault: Vault, folderId: string | null): string {
  const byId = new Map(vault.listFolders({ includeTrashed: true }).map((f) => [f.id, f]))
  const parts: string[] = []
  for (let id = folderId, guard = 0; id && guard < 100; guard++) {
    const f = byId.get(id)
    if (!f) break
    parts.unshift(f.name)
    id = f.parentId
  }
  return parts.join(' / ')
}

function exactNote(vault: Vault, title: string): NoteMeta | undefined {
  const t = normalizeTitle(title)
  return t ? vault.listNotes().find((n) => normalizeTitle(n.title) === t) : undefined
}

export async function linkItems(ctx: EditorContext, query: string): Promise<LinkItem[]> {
  const vault = ctx.vault
  if (!vault) return []
  const hash = query.indexOf('#')
  if (hash >= 0) {
    const note = exactNote(vault, query.slice(0, hash))
    if (note) {
      const rows = await ctx.searchBlocks(note.id, query.slice(hash + 1).trim())
      return rows
        .filter((b) => b.text.trim() !== '')
        .slice(0, MAX_ITEMS)
        .map((b) => ({ kind: 'block', noteId: note.id, blockId: b.blockId, type: b.type, text: b.text }))
    }
  }
  const needle = query.trim().toLowerCase()
  const notes: LinkItem[] = vault
    .listNotes()
    .filter((n) => displayTitle(n.title).toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ITEMS)
    .map((n) => ({ kind: 'note', id: n.id, title: displayTitle(n.title), path: folderPath(vault, n.folderId) }))
  if (needle && !exactNote(vault, query)) notes.push({ kind: 'create', title: query.trim() })
  return notes
}

function insertLink(editor: Editor, range: Range, target: LinkTarget) {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [{ type: 'noteLink', attrs: target }, { type: 'text', text: ' ' }])
    .run()
}

export function runLinkItem(ctx: EditorContext, editor: Editor, range: Range, item: LinkItem) {
  if (item.kind === 'note') insertLink(editor, range, { noteId: item.id, blockId: null })
  else if (item.kind === 'block') insertLink(editor, range, { noteId: item.noteId, blockId: item.blockId })
  else {
    let id: string
    try {
      id = ctx.vault.createNote({ title: item.title }).id
    } catch {
      const existing = exactNote(ctx.vault, item.title)
      if (!existing) return
      id = existing.id
    }
    insertLink(editor, range, { noteId: id, blockId: null })
  }
}

type ListProps = { items: LinkItem[]; blockPhase: boolean; command: (item: LinkItem) => void }

const itemKey = (it: LinkItem) => (it.kind === 'note' ? it.id : it.kind === 'block' ? it.blockId : `create:${it.title}`)

const LinkList = forwardRef<PopupListHandle, ListProps>(function LinkList({ items, blockPhase, command }, ref) {
  const [selected, setSelected] = useState(0)
  const [prevItems, setPrevItems] = useState(items)
  if (prevItems !== items) {
    setPrevItems(items)
    setSelected(0)
  }
  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return true
        const d = e.key === 'ArrowDown' ? 1 : -1
        setSelected((s) => (s + d + items.length) % items.length)
        return true
      }
      if (e.key === 'Enter') {
        if (!items.length) return false
        const item = items[selected]
        if (item) command(item)
        return true
      }
      return false
    },
  }))
  useEffect(() => {
    document.querySelector('[data-link-menu] [aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  return (
    <div data-link-menu className="glass-float popup-pop max-h-80 w-[320px] overflow-y-auto p-1.5">
      {items.length === 0 ? (
        <div className="px-2 py-3 text-sm text-fg-secondary">{blockPhase ? '沒有符合的區塊' : '沒有符合的筆記'}</div>
      ) : (
        <div role="listbox" aria-label={blockPhase ? '連結到區塊' : '連結到筆記'}>
          {items.map((item, i) => (
            <div
              key={itemKey(item)}
              role="option"
              aria-selected={i === selected}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setSelected(i)}
              onClick={() => command(item)}
              className={`flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 ${i === selected ? 'bg-accent/10' : ''}`}
            >
              {item.kind === 'note' && (
                <span className="min-w-0">
                  <span className="block truncate text-base text-fg">{item.title}</span>
                  {item.path && <span className="block truncate text-xs text-fg-secondary">{item.path}</span>}
                </span>
              )}
              {item.kind === 'create' && <span className="truncate text-base text-accent">建立新筆記「{item.title}」</span>}
              {item.kind === 'block' && (
                <>
                  <span className="shrink-0 rounded-control bg-fill px-1.5 py-px text-xs text-fg-secondary">
                    {TYPE_BADGES[item.type] ?? '區塊'}
                  </span>
                  <span className="truncate text-base text-fg">{Array.from(item.text).slice(0, 40).join('')}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export function createLinkSuggestion(ctx: EditorContext) {
  return Extension.create({
    name: 'noteLinkSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<LinkItem, LinkItem>({
          editor: this.editor,
          pluginKey: new PluginKey('noteLinkSuggestion'),
          char: '[[',
          allowSpaces: true,
          allowedPrefixes: null,
          findSuggestionMatch: findLinkQuery,
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          items: ({ query }) => linkItems(ctx, query),
          command: ({ editor, range, props }) => runLinkItem(ctx, editor, range, props),
          render: suggestionPopup<LinkItem, ListProps>(LinkList, (props) => ({
            items: props.items,
            blockPhase: props.items.length > 0 ? props.items[0].kind === 'block' : props.query.includes('#'),
            command: props.command,
          })),
        }),
      ]
    },
  })
}
