import type { Editor } from '@tiptap/core'
import { addMedia, MediaError } from './add-media'
import type { EditorContext } from '../extensions'

export function mediaErrorMessage(e: unknown): string {
  return e instanceof MediaError ? e.message : '無法加入這個檔案。'
}

/** Adds files in order, then inserts the successful ones as media blocks at `pos` (default: cursor). Errors go to ctx.onMediaError. */
export async function insertMediaFiles(editor: Editor, files: File[], ctx: EditorContext | null, pos?: number): Promise<void> {
  if (!ctx) return
  const at = pos ?? editor.state.selection.to
  const nodes: { type: 'media'; attrs: { attachmentId: string; kind: string; width: null } }[] = []
  for (const file of files) {
    try {
      const { attachmentId, kind } = await addMedia(file, { vault: ctx.vault, storage: ctx.storage })
      nodes.push({ type: 'media', attrs: { attachmentId, kind, width: null } })
    } catch (e) {
      ctx.onMediaError?.(mediaErrorMessage(e))
    }
  }
  if (!nodes.length || editor.isDestroyed) return
  const { doc } = editor.state
  const p = Math.max(0, Math.min(at, doc.content.size))
  const $p = doc.resolve(p)
  const empty = $p.parent.isTextblock && $p.parent.content.size === 0
  let range = { from: p, to: p }
  if (empty && $p.depth === 1) {
    range = { from: $p.before(), to: $p.after() }
  } else if (empty && $p.depth > 1) {
    // Empty paragraph inside a list / task item / callout: keep it, insert after the outermost container.
    const after = $p.after(1)
    range = { from: after, to: after }
  }
  const atEnd = range.to >= doc.content.size
  editor
    .chain()
    .focus()
    .insertContentAt(range, atEnd ? [...nodes, { type: 'paragraph' }] : nodes)
    .run()
}

export function pickFiles(onPicked: (files: File[]) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,video/*'
  input.multiple = true
  input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0'
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  input.addEventListener('change', () => {
    onPicked(Array.from(input.files ?? []))
    input.remove()
  })
  input.addEventListener('cancel', () => input.remove())
  document.body.appendChild(input)
  input.click()
}
