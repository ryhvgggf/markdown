import { useCallback, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { mergeAttributes, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { EditorContext } from '../extensions'
import { useBlobUrl } from '../media/use-blob-url'
import { formatBytes } from '@/core/attachments'
import { Download, FileIcon } from '@/ui/icons'
import { insertMediaFiles, pickFiles } from '../media/insert-files'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    media: {
      /** Opens the file picker (images and videos) and inserts the chosen files at the cursor. */
      pickMedia: () => ReturnType
      /** Opens the file picker (any type) and inserts the chosen files at the cursor. */
      pickFile: () => ReturnType
    }
  }
}

export const MIN_MEDIA_WIDTH = 80

/** Saves a blob: URL under `name` (an anchor outside the editor, so the editor's link handling never sees it). */
export function downloadUrl(url: string, name: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function clampWidth(w: number, max: number): number {
  return Math.round(Math.max(MIN_MEDIA_WIDTH, Math.min(w, Math.max(max, MIN_MEDIA_WIDTH))))
}

/** "Copy image" yields an image file plus `<img>`-only html: only html with real text, or non-blank plain text, counts as text. */
export function hasPastedText(data: DataTransfer | null): boolean {
  if (!data) return false
  if (data.getData('text/plain').trim()) return true
  const html = data.getData('text/html')
  return !!html && !!new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim()
}

export type MediaOptions = { ctx: EditorContext | null }

type AttachmentState = 'live' | 'trashed' | 'gone' | 'unknown'

/** The attachment's vault state, re-read on vault changes (a primitive, so unrelated changes do not re-render). */
function useAttachmentState(vault: EditorContext['vault'] | undefined, id: string): AttachmentState {
  const subscribe = useCallback((cb: () => void) => (vault ? vault.observe(cb) : () => undefined), [vault])
  const get = (): AttachmentState => {
    if (!vault || !id) return 'unknown'
    const a = vault.getAttachment(id)
    return !a ? 'gone' : a.deletedAt === null ? 'live' : 'trashed'
  }
  return useSyncExternalStore(subscribe, get, get)
}

function MediaView({ node, selected, updateAttributes, editor, extension }: ReactNodeViewProps) {
  const ctx = (extension.options as MediaOptions).ctx
  const { attachmentId, kind, width } = node.attrs as { attachmentId: string; kind: 'image' | 'video' | 'file'; width: number | null }
  const state = useAttachmentState(ctx?.vault, attachmentId)
  // Permanently deleted (metadata gone): reload, so the view does not keep showing a revoked file.
  const { url, status } = useBlobUrl(ctx?.storage, state === 'gone' ? '' : attachmentId)
  const meta = ctx?.vault.getAttachment(attachmentId)
  const filename = meta?.filename ?? ''
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const shown = dragWidth ?? width

  function onHandleDown(e: ReactPointerEvent<HTMLSpanElement>) {
    if (!editor.isEditable) return
    e.preventDefault()
    e.stopPropagation()
    const box = wrapRef.current
    if (!box) return
    const max = box.parentElement?.clientWidth ?? box.clientWidth
    const startX = e.clientX
    const startW = box.getBoundingClientRect().width
    let latest = clampWidth(startW, max)
    const move = (ev: PointerEvent) => {
      latest = clampWidth(startW + ev.clientX - startX, max)
      setDragWidth(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDragWidth(null)
      if (latest !== width) updateAttributes({ width: latest })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  let body
  if (state === 'trashed') {
    body = (
      <div className="media-placeholder flex-col gap-2 text-fg-tertiary" contentEditable={false}>
        <span>這個附件已移到垃圾桶</span>
        <button
          type="button"
          className="rounded-control bg-fill px-2.5 py-1 text-xs text-fg hover:bg-black/10"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ctx?.vault.getAttachment(attachmentId) && ctx.vault.restoreAttachment(attachmentId)} // gone if purged meanwhile
        >
          還原
        </button>
      </div>
    )
  } else if (state === 'gone') {
    body = <div className="media-placeholder text-fg-tertiary">找不到這個檔案</div>
  } else if (kind === 'file') {
    body = (
      <div className="media-file" contentEditable={false}>
        <FileIcon size={20} className="shrink-0 text-fg-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-fg" title={filename}>
            {filename || '未命名檔案'}
          </span>
          {meta && <span className="block text-xs text-fg-tertiary">{formatBytes(meta.size)}</span>}
        </span>
        {status === 'ready' && url ? (
          <button
            type="button"
            aria-label={`下載 ${filename}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-control bg-fill px-2.5 py-1 text-xs text-fg hover:bg-black/10"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => downloadUrl(url, filename || 'file')}
          >
            <Download size={14} />
            下載
          </button>
        ) : (
          <span className="shrink-0 text-xs text-fg-tertiary">{status === 'loading' ? '載入中…' : '找不到這個檔案'}</span>
        )}
      </div>
    )
  } else if (status === 'loading') {
    body = <div className="media-placeholder text-fg-tertiary">載入中…</div>
  } else if (status === 'missing' || !url) {
    body = <div className="media-placeholder text-fg-tertiary">找不到這個檔案</div>
  } else if (kind === 'video') {
    body = <video src={url} controls preload="metadata" style={{ borderRadius: 12, maxWidth: '100%', width: '100%' }} />
  } else {
    body = <img src={url} alt={filename} draggable={false} style={{ borderRadius: 12, maxWidth: '100%', width: '100%', display: 'block' }} />
  }

  return (
    <NodeViewWrapper className="media-block" data-type="media" data-kind={kind} data-selected={selected ? 'true' : undefined}>
      <div
        ref={wrapRef}
        className="media-frame"
        style={{ width: shown ? `${shown}px` : undefined, maxWidth: '100%', borderRadius: 12, boxShadow: selected ? '0 0 0 2px var(--accent)' : undefined }}
      >
        {body}
        {kind === 'image' && selected && editor.isEditable && status === 'ready' && state !== 'trashed' && state !== 'gone' && (
          <span
            role="slider"
            aria-label="調整圖片寬度"
            aria-valuemin={MIN_MEDIA_WIDTH}
            aria-valuenow={shown ?? undefined}
            className="media-resize-handle"
            contentEditable={false}
            onPointerDown={onHandleDown}
          />
        )}
      </div>
    </NodeViewWrapper>
  )
}

const MEDIA_KINDS = ['image', 'video', 'file']

export const Media = Node.create<MediaOptions>({
  name: 'media',
  priority: 300, // file paste runs before the block-link and Markdown paste plugins
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { ctx: null }
  },
  addAttributes() {
    return {
      attachmentId: { default: '', parseHTML: (el) => el.getAttribute('data-attachment-id') ?? '', renderHTML: (a) => ({ 'data-attachment-id': a.attachmentId }) },
      kind: { default: 'image', parseHTML: (el) => (MEDIA_KINDS.includes(el.getAttribute('data-kind') ?? '') ? el.getAttribute('data-kind') : 'image'), renderHTML: (a) => ({ 'data-kind': a.kind }) },
      width: {
        default: null,
        parseHTML: (el) => {
          const n = Number(el.getAttribute('data-width'))
          return n > 0 ? n : null
        },
        renderHTML: (a) => (a.width ? { 'data-width': String(a.width) } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="media"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'media' }, HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(MediaView)
  },
  addCommands() {
    const ctx = this.options.ctx
    return {
      pickMedia:
        () =>
        ({ editor }) => {
          pickFiles((files) => void insertMediaFiles(editor, files, ctx), 'image/*,video/*')
          return true
        },
      pickFile:
        () =>
        ({ editor }) => {
          pickFiles((files) => void insertMediaFiles(editor, files, ctx))
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const ctx = this.options.ctx
    return [
      new Plugin({
        key: new PluginKey('mediaFiles'),
        props: {
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? [])
            if (!files.length || !ctx) return false
            event.preventDefault()
            let pos: number | undefined
            try {
              pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            } catch {
              pos = undefined
            }
            void insertMediaFiles(editor, files, ctx, pos)
            return true
          },
          handlePaste(view, event) {
            if (view.composing) return false
            const data = event.clipboardData
            const files = Array.from(data?.files ?? [])
            if (!files.length || !ctx) return false
            // Office / browser copies carry an image next to text: let the text handlers win.
            if (hasPastedText(data)) return false
            event.preventDefault()
            void insertMediaFiles(editor, files, ctx)
            return true
          },
        },
      }),
    ]
  },
})
