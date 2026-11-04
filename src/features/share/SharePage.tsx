import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { editorSchema } from '@/app/doc-io'
import { ShareError, type ShareAdapter } from '@/adapters/share/types'
import { openSharedLink } from '@/core/share/share-service'
import type { ShareSnapshot } from '@/core/share/snapshot'
import { createExtensions, type EditorContext } from '@/features/editor/extensions'

type State = { s: 'loading' } | { s: 'error'; text: string } | { s: 'ready'; snapshot: ShareSnapshot }

const INVALID = '連結無效或已停止分享'
const UNREACHABLE = '無法開啟此連結'

/** What the 分享頁 shows for each failure; no error text from the server or the browser is displayed. */
export const shareErrorText = (e: unknown) => (e instanceof ShareError && (e.kind === 'not-found' || e.kind === 'invalid') ? INVALID : UNREACHABLE)

/** A shared note: read-only, no account, no local database. The key never leaves the `#` part of the URL. */
export function SharePage({ adapter }: { adapter: ShareAdapter | (() => Promise<ShareAdapter>) }) {
  const [state, setState] = useState<State>({ s: 'loading' })
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const a = typeof adapter === 'function' ? await adapter() : adapter
        const snapshot = await openSharedLink(a, new URL(location.href), (doc) => void editorSchema().nodeFromJSON(doc).check())
        if (!cancelled) setState({ s: 'ready', snapshot })
      } catch (e) {
        if (!cancelled) setState({ s: 'error', text: shareErrorText(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter])

  useEffect(() => {
    if (state.s === 'ready') document.title = state.snapshot.title
  }, [state])

  if (state.s === 'loading') return <div className="grid min-h-dvh place-items-center text-fg-tertiary">載入中…</div>
  if (state.s === 'error') return <div role="alert" className="grid min-h-dvh place-items-center px-6 text-center text-fg-secondary">{state.text}</div>
  return (
    <ShowErrors>
      <SharedNote snapshot={state.snapshot} />
    </ShowErrors>
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

function SharedNote({ snapshot }: { snapshot: ShareSnapshot }) {
  // The same editor schema and styles as the app, on a throwaway document filled from the snapshot.
  const extensions = useMemo(() => {
    const ydoc = new Y.Doc()
    prosemirrorJSONToYXmlFragment(editorSchema(), snapshot.doc, ydoc.getXmlFragment('content'))
    return createExtensions(ydoc, { noteId: '' } as unknown as EditorContext)
  }, [snapshot])
  const editor = useEditor({ extensions, editable: false, editorProps: { attributes: { class: 'note-editor', 'aria-label': '筆記內容' } } }, [extensions])
  return (
    <main className="note-card mx-auto min-h-dvh max-w-[920px] bg-surface px-6 pb-32 pt-12 sm:my-4 sm:min-h-0 sm:rounded-card sm:shadow-card">
      <div className="mx-auto" style={{ maxWidth: 'var(--editor-width, 680px)' }}>
        <h1 data-share-title className="mb-4 font-semibold text-fg" style={{ fontSize: 'var(--text-display)', letterSpacing: '-0.022em', lineHeight: 1.25 }}>
          {snapshot.title}
        </h1>
        <EditorContent editor={editor} />
      </div>
    </main>
  )
}
