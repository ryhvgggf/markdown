import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { editorSchema } from '@/app/doc-io'
import { ShareError, type ShareAdapter } from '@/adapters/share/types'
import { openShareFile, openSharedLink } from '@/core/share/share-service'
import { shareBlobType, type ShareFile } from '@/core/share/files'
import type { PMNode } from '@/core/markdown/types'
import type { AnyShareSnapshot, MultiShareSnapshot } from '@/core/share/snapshot'
import { OutlineView, type OutlineEntry } from '@/features/panel/OutlineTicks'
import { extractHeadings, READ_LINE, reducedMotion } from '@/features/panel/use-outline'
import { createExtensions, type EditorContext } from '@/features/editor/extensions'

type State =
  | { s: 'loading' }
  | { s: 'error'; text: string }
  | { s: 'password'; wrong: boolean }
  | { s: 'ready'; snapshot: AnyShareSnapshot; files: SharedFiles }

type SharedFiles = NonNullable<EditorContext['sharedFiles']>

/** The link's attachments for the editor: fetched from storage and decrypted when a `media` node asks for one. */
function sharedFilesOf(adapter: ShareAdapter, files: ShareFile[] | undefined): SharedFiles {
  const byCode = new Map((files ?? []).map((f) => [f.code, f]))
  return {
    find: (code) => byCode.get(code),
    load: async (code, kind) => {
      const f = byCode.get(code)
      if (!f) throw new ShareError('not-found')
      const bytes = await openShareFile(adapter, new URL(location.href), f)
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: shareBlobType(f, kind) })
    },
  }
}

const INVALID = '連結無效或已停止分享'
const UNREACHABLE = '無法開啟此連結'
const EXPIRED = '連結已過期'
const TITLE = '\u0000title'

/** What the 分享頁 shows for each failure; no error text from the server or the browser is displayed. */
export const shareErrorText = (e: unknown) =>
  e instanceof ShareError && (e.kind === 'not-found' || e.kind === 'invalid') ? INVALID : e instanceof ShareError && e.kind === 'expired' ? EXPIRED : UNREACHABLE

/** A shared note: read-only, no account, no local database. The key never leaves the `#` part of the URL. */
export function SharePage({ adapter }: { adapter: ShareAdapter | (() => Promise<ShareAdapter>) }) {
  const [state, setState] = useState<State>({ s: 'loading' })
  const [attempt, setAttempt] = useState<{ password?: string; n: number }>({ n: 0 })
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const a = typeof adapter === 'function' ? await adapter() : adapter
        const snapshot = await openSharedLink(a, new URL(location.href), (doc) => void editorSchema().nodeFromJSON(doc).check(), attempt.password)
        if (!cancelled) setState({ s: 'ready', snapshot, files: sharedFilesOf(a, snapshot.files) })
      } catch (e) {
        if (cancelled) return
        if (e instanceof ShareError && (e.kind === 'password-required' || e.kind === 'wrong-password')) setState({ s: 'password', wrong: e.kind === 'wrong-password' })
        else setState({ s: 'error', text: shareErrorText(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, attempt])

  useEffect(() => {
    if (state.s === 'ready' && state.snapshot.v === 1) document.title = state.snapshot.title
  }, [state])

  if (state.s === 'loading') return <div className="grid min-h-dvh place-items-center text-fg-tertiary">載入中…</div>
  if (state.s === 'password') return <PasswordForm wrong={state.wrong} onSubmit={(password) => { setState({ s: 'loading' }); setAttempt((a) => ({ password, n: a.n + 1 })) }} />
  if (state.s === 'error') return <div role="alert" className="grid min-h-dvh place-items-center px-6 text-center text-fg-secondary">{state.text}</div>
  return (
    <ShowErrors>
      {state.snapshot.v === 1 ? <SharedNote title={state.snapshot.title} doc={state.snapshot.doc} files={state.files} /> : <MultiNotes snapshot={state.snapshot} files={state.files} />}
    </ShowErrors>
  )
}

/** A protected link: no title or content until the password is right. */
function PasswordForm({ wrong, onSubmit }: { wrong: boolean; onSubmit: (password: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <form
        className="flex w-full max-w-xs flex-col gap-3 text-center"
        onSubmit={(e) => {
          e.preventDefault()
          if (value) onSubmit(value)
        }}
      >
        <p className="text-base text-fg">此文件受到密碼保護。請輸入密碼以開啟文件。</p>
        <input
          type="password"
          aria-label="密碼"
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 rounded-control border border-black/10 bg-white/70 px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {wrong && (
          <p role="alert" className="text-sm text-red-700">
            密碼錯誤
          </p>
        )}
        <button type="submit" disabled={!value} className="h-9 rounded-control bg-accent text-sm font-medium text-white disabled:opacity-50">
          開啟
        </button>
      </form>
    </main>
  )
}

/** A shared note the editor still cannot render must not leave a blank page. */
class ShowErrors extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <div role="alert" className="grid min-h-dvh place-items-center px-6 text-center text-fg-secondary">{UNREACHABLE}</div> : this.props.children
  }
}

/**
 * A link that shows several notes: the notes down the left (a menu on a narrow screen), the chosen one on the
 * right. The chosen note is kept in the address as `?n=n2` (the snapshot's own code, never a real id; the key
 * stays after `#`), so a reload or a copied address stays on it. A link to another note of the same snapshot
 * switches to it and scrolls to the block.
 */
function MultiNotes({ snapshot, files }: { snapshot: MultiShareSnapshot; files: SharedFiles }) {
  const codes = useMemo(() => snapshot.notes.map((n) => n.id), [snapshot])
  const [view, setView] = useState<{ code: string; blockId: string | null; nonce?: number }>(() => {
    const n = new URLSearchParams(location.search).get('n')
    return { code: n !== null && codes.includes(n) ? n : codes[0], blockId: null }
  })
  const go = useCallback(
    (code: string, blockId: string | null) => {
      if (!codes.includes(code)) return
      setView((v) => ({ code, blockId, nonce: (v.nonce ?? 0) + 1 }))
      const query = code === codes[0] ? '' : `?n=${code}`
      window.history.replaceState(window.history.state, '', `${location.pathname}${query}${location.hash}`)
    },
    [codes],
  )
  const open = useCallback((noteId: string, blockId?: string) => go(noteId, blockId ?? null), [go])
  const note = snapshot.notes.find((n) => n.id === view.code) ?? snapshot.notes[0]
  useEffect(() => {
    document.title = note.title
  }, [note])
  return (
    <div className="sm:pl-56">
      <nav aria-label="筆記清單" className="fixed top-0 bottom-0 left-0 hidden w-56 overflow-auto border-r border-black/5 bg-surface/60 px-2 py-4 sm:block">
        <ul className="flex flex-col gap-0.5">
          {snapshot.notes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                aria-current={n.id === note.id ? 'page' : undefined}
                onClick={() => go(n.id, null)}
                className={`w-full truncate rounded-control px-3 py-1.5 text-left text-sm outline-none transition-colors hover:bg-fill focus-visible:ring-2 focus-visible:ring-accent ${n.id === note.id ? 'bg-fill font-medium text-fg' : 'text-fg-secondary'}`}
              >
                {n.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="px-4 pt-3 sm:hidden">
        <select
          aria-label="選擇筆記"
          value={note.id}
          onChange={(e) => go(e.target.value, null)}
          className="h-9 w-full rounded-control border border-black/10 bg-white/70 px-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {snapshot.notes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      </div>
      <SharedNote key={note.id} title={note.title} doc={note.doc} files={files} onOpenLink={open} blockId={view.blockId} nonce={view.nonce} />
    </div>
  )
}

function SharedNote({
  title,
  doc,
  files,
  onOpenLink,
  blockId,
  nonce,
}: {
  title: string
  doc: PMNode
  files: SharedFiles
  /** Multi-note links: opens another note of the link (by its code). */
  onOpenLink?: (noteId: string, blockId?: string) => void
  /** After a switch (`nonce` set): the block to scroll to; without one the page goes to the top. */
  blockId?: string | null
  nonce?: number
}) {
  // The same editor schema and styles as the app, on a throwaway document filled from the snapshot.
  const extensions = useMemo(() => {
    const ydoc = new Y.Doc()
    prosemirrorJSONToYXmlFragment(editorSchema(), doc, ydoc.getXmlFragment('content'))
    return createExtensions(ydoc, { noteId: '', sharedFiles: files, ...(onOpenLink && { shared: { open: onOpenLink } }) } as unknown as EditorContext)
  }, [doc, onOpenLink, files])
  const editor = useEditor({ extensions, editable: false, editorProps: { attributes: { class: 'note-editor', 'aria-label': '筆記內容' } } }, [extensions])
  useEffect(() => {
    if (!editor || nonce === undefined) return
    const frame = requestAnimationFrame(() => {
      const el = blockId ? document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`) : null
      if (el) el.scrollIntoView?.({ block: 'start' })
      else window.scrollTo?.(0, 0)
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, blockId, nonce])
  const entries = useMemo<OutlineEntry[]>(
    () => [{ id: TITLE, level: 0, text: title }, ...extractHeadings(editorSchema().nodeFromJSON(doc))],
    [title, doc],
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  useEffect(() => {
    let frame = 0
    const compute = () => {
      frame = 0
      let current: string | null = null
      for (const e of entries) {
        if (e.id === TITLE) continue
        const el = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(e.id)}"]`)
        if (el && el.getBoundingClientRect().top <= READ_LINE) current = e.id
      }
      setActiveId(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(compute)
    }
    compute()
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      window.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [entries])
  const pick = (id: string) => {
    const el = id === TITLE ? document.querySelector<HTMLElement>('[data-share-title]') : document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
    setActiveId(id === TITLE ? null : id)
  }
  return (
    <>
    <OutlineView entries={entries} activeId={activeId} onPick={pick} fixed />
    <main className="note-card mx-auto min-h-dvh max-w-[920px] bg-surface px-6 pb-32 pt-12 sm:my-4 sm:min-h-0 sm:rounded-card sm:shadow-card">
      <div className="mx-auto" style={{ maxWidth: 'var(--editor-width, 680px)' }}>
        <h1 data-share-title className="mb-4 font-semibold text-fg" style={{ fontSize: 'var(--text-display)', letterSpacing: '-0.022em', lineHeight: 1.25 }}>
          {title}
        </h1>
        <EditorContent editor={editor} />
      </div>
    </main>
    </>
  )
}
