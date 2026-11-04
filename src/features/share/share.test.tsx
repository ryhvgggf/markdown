import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { MemoryShare } from '@/adapters/share/memory-share'
import { bootstrap, type AppServices } from '@/app/bootstrap'
import { editorSchema } from '@/app/doc-io'
import { ServicesProvider } from '@/app/services-context'
import { createShareFacade } from '@/app/share-facade'
import { useUi } from '@/app/ui-store'
import { createShareService } from '@/core/share/share-service'
import { buildShareSnapshot } from '@/core/share/snapshot'
import { ShareDialog } from './ShareDialog'
import { SharePage } from './SharePage'
import { snapshotOfNote } from './note-snapshot'

let n = 0
const doc = (...texts: string[]) => ({ type: 'doc', content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })

async function setup(signedIn = true) {
  const adapter = new MemoryShare()
  const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const services = await bootstrap({
    dbName: `share-ui-${n++}`,
    forceMemory: true,
    seedGuide: false,
    createShare: (db) =>
      createShareFacade({ db, origin: 'https://notes.test', adapter: async () => adapter, account: async () => (signedIn ? { userId: 'u', vaultId: 'v', kek } : null) }),
  })
  const note = services.vault.createNote({ title: '我的筆記' })
  const ydoc = await services.notes.acquire(note.id)
  prosemirrorJSONToYXmlFragment(editorSchema(), doc('第一段', '第二段'), ydoc.getXmlFragment('content'))
  services.notes.release(note.id)
  return { adapter, services, note }
}

function show(services: AppServices) {
  render(
    <ServicesProvider services={services}>
      <ShareDialog />
    </ServicesProvider>,
  )
}

afterEach(() => act(() => useUi.setState({ shareNoteId: null })))

describe('note snapshot', () => {
  it('has the note content, the title, and the label of linked notes as plain text', async () => {
    const { services, note } = await setup()
    const other = services.vault.createNote({ title: '另一篇' })
    const ydoc = await services.notes.acquire(note.id)
    const frag = ydoc.getXmlFragment('content')
    frag.delete(0, frag.length)
    prosemirrorJSONToYXmlFragment(
      editorSchema(),
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '見 ' }, { type: 'noteLink', attrs: { noteId: other.id, blockId: null } }] }] },
      frag,
    )
    services.notes.release(note.id)
    const s = await snapshotOfNote(services, note.id, 123)
    expect(s.title).toBe('我的筆記')
    expect(s.sharedAt).toBe(123)
    expect(JSON.stringify(s.doc)).toContain('另一篇')
    expect(JSON.stringify(s.doc)).not.toContain('noteLink')
    expect(JSON.stringify(s.doc)).not.toContain(other.id)
  })
})

describe('分享 dialog', () => {
  it('signed out: asks to sign in and offers the account page', async () => {
    const { services, note } = await setup(false)
    show(services)
    const user = userEvent.setup()
    act(() => useUi.getState().setShareNote(note.id))
    const dialog = await screen.findByRole('dialog', { name: '分享' })
    expect(await within(dialog).findByText('登入後即可分享')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '前往登入' }))
    expect(useUi.getState().settingsOpen).toBe(true)
    expect(useUi.getState().settingsSection).toBe('account')
    expect(useUi.getState().shareNoteId).toBeNull()
  })

  it('a build without cloud says so and offers no sign-in', async () => {
    const services = await bootstrap({
      dbName: `share-ui-${n++}`,
      forceMemory: true,
      seedGuide: false,
      createShare: (db) => createShareFacade({ db, origin: 'https://notes.test', adapter: null }),
    })
    const note = services.vault.createNote({ title: 'x' })
    show(services)
    act(() => useUi.getState().setShareNote(note.id))
    const dialog = await screen.findByRole('dialog', { name: '分享' })
    expect(await within(dialog).findByText('這個版本沒有設定雲端同步，筆記只存在這台裝置。')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button')).toBeNull()
  })

  it('creates a link, shows it again later, updates the snapshot and stops sharing', async () => {
    const { adapter, services, note } = await setup()
    show(services)
    const user = userEvent.setup()
    act(() => useUi.getState().setShareNote(note.id))
    const dialog = await screen.findByRole('dialog', { name: '分享' })
    await user.click(await within(dialog).findByRole('button', { name: '建立連結' }))
    const field = (await within(dialog).findByLabelText('分享連結')) as HTMLInputElement
    expect(field.value).toMatch(/^https:\/\/notes\.test\/s\/[\w-]{22}#[\w-]{43}$/)
    expect(adapter.rows.size).toBe(1)
    expect(within(dialog).getByText(/快照時間/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '更新快照' }))
    await waitFor(() => expect([...adapter.rows.values()][0]!.updatedAt).toBeGreaterThanOrEqual([...adapter.rows.values()][0]!.createdAt))

    // closing and opening again shows the same link (copy it again on any device)
    act(() => useUi.getState().setShareNote(null))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '分享' })).toBeNull())
    act(() => useUi.getState().setShareNote(note.id))
    const again = (await screen.findByLabelText('分享連結')) as HTMLInputElement
    expect(again.value).toBe(field.value)

    await user.click(screen.getByRole('button', { name: '停止分享' }))
    expect(screen.getByText('停止分享？連結將立即失效。')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '停止分享' }).at(-1)!)
    expect(await screen.findByRole('button', { name: '建立連結' })).toBeInTheDocument()
    expect(adapter.rows.size).toBe(0)
  })
})

describe('分享頁', () => {
  async function link() {
    const adapter = new MemoryShare()
    const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const svc = createShareService({ adapter, account: () => ({ userId: 'u', vaultId: 'v', kek }), origin: 'https://notes.test' })
    const snapshot = buildShareSnapshot({ title: '公開的筆記', doc: doc('給大家看的內容'), sharedAt: 1, linkLabel: () => null })
    const { url } = await svc.create('n1', snapshot)
    return { adapter, svc, url: new URL(url) }
  }
  const at = (u: URL) => window.history.replaceState(null, '', `${u.pathname}${u.hash}`)
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('shows the title and content read-only', async () => {
    const { adapter, url } = await link()
    at(url)
    render(<SharePage adapter={adapter} />)
    expect(await screen.findByRole('heading', { name: '公開的筆記' })).toBeInTheDocument()
    const body = await screen.findByLabelText('筆記內容')
    expect(body).toHaveTextContent('給大家看的內容')
    expect(body).toHaveAttribute('contenteditable', 'false')
  })

  it('a stopped link and a wrong key both say the link is invalid; nothing else leaks', async () => {
    const { adapter, svc, url } = await link()
    const [record] = await svc.listForNote('n1')
    at(new URL(`${url.origin}${url.pathname}#${'A'.repeat(43)}`))
    const { unmount } = render(<SharePage adapter={adapter} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('連結無效或已停止分享')
    unmount()
    await svc.stop(record!.id)
    at(url)
    render(<SharePage adapter={adapter} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('連結無效或已停止分享')
  })

  it('a link that cannot be reached says so without the error text', async () => {
    const { url } = await link()
    at(url)
    const broken = new MemoryShare()
    broken.getPublic = async () => {
      throw new Error('secret server detail')
    }
    render(<SharePage adapter={broken} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('無法開啟此連結')
    expect(alert).not.toHaveTextContent('secret')
  })
})

