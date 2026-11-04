import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { editorSchema } from '@/app/doc-io'
import { ShareError, type ShareAdapter } from '@/adapters/share/types'
import { openSharedLink } from '@/core/share/share-service'
import type { ShareSnapshot } from '@/core/share/snapshot'
import { createExtensions, type EditorContext } from '@/features/editor/extensions'

type State =
  | { s: 'loading' }
  | { s: 'error'; text: string }
  | { s: 'password'; wrong: boolean }
  | { s: 'ready'; snapshot: ShareSnapshot }

const INVALID = '連結無效或已停止分享'
const UNREACHABLE = '無法開啟此連結'
const EXPIRED = '連結已過期'

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
        if (!cancelled) setState({ s: 'ready', snapshot })
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
    if (state.s === 'ready') document.title = state.snapshot.title
  }, [state])

  if (state.s === 'loading') return <div className="grid min-h-dvh place-items-center text-fg-tertiary">載入中…</div>
  if (state.s === 'password') return <PasswordForm wrong={state.wrong} onSubmit={(password) => { setState({ s: 'loading' }); setAttempt((a) => ({ password, n: a.n + 1 })) }} />
  if (state.s === 'error') return <div role="alert" className="grid min-h-dvh place-items-center px-6 text-center text-fg-secondary">{state.text}</div>
  return (
    <ShowErrors>
      <SharedNote snapshot={state.snapshot} />
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
        <p className="text-base text-fg">這篇筆記需要密碼</p>
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
