import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { MemoryShare, type MemoryShareRow } from '@/adapters/share/memory-share'
import { bootstrap, type AppServices } from '@/app/bootstrap'
import { editorSchema } from '@/app/doc-io'
import { ServicesProvider } from '@/app/services-context'
import { createShareFacade } from '@/app/share-facade'
import { useUi } from '@/app/ui-store'
import { createShareService } from '@/core/share/share-service'
import { buildMultiShareSnapshot, buildShareSnapshot } from '@/core/share/snapshot'
import { ShareDialog } from './ShareDialog'
import { SharesPage } from './SharesPage'
import { SharePage } from './SharePage'
import { snapshotOfNote, snapshotOfNotes } from './note-snapshot'

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

  it('multi-note: links between shared notes stay links to codes the editor schema accepts; others become text', async () => {
    const { services, note } = await setup()
    const b = services.vault.createNote({ title: 'B 篇' })
    const out = services.vault.createNote({ title: '沒分享' })
    const ydoc = await services.notes.acquire(note.id)
    const frag = ydoc.getXmlFragment('content')
    frag.delete(0, frag.length)
    const linkTo = (noteId: string) => ({ type: 'noteLink', attrs: { noteId, blockId: null } })
    prosemirrorJSONToYXmlFragment(editorSchema(), { type: 'doc', content: [{ type: 'paragraph', content: [linkTo(b.id), { type: 'text', text: ' ' }, linkTo(out.id)] }] }, frag)
    services.notes.release(note.id)
    const { noteIds, snapshot: s } = await snapshotOfNotes(services, [note.id, b.id], 9)
    expect(noteIds).toEqual([note.id, b.id])
    expect(s.notes.map((x) => x.title)).toEqual(['我的筆記', 'B 篇'])
    expect(s.notes[0].doc.content?.[0].content).toEqual([
      { type: 'noteLink', attrs: { noteId: 'n1', blockId: null, label: 'B 篇' } },
      { type: 'text', text: ' ' },
      { type: 'text', text: '沒分享' },
    ])
    for (const x of s.notes) editorSchema().nodeFromJSON(x.doc).check()
    for (const id of [note.id, b.id, out.id]) expect(JSON.stringify(s)).not.toContain(id)
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

  it('stopping sharing stops every link of the note, not only the newest', async () => {
    const { adapter, services, note } = await setup()
    show(services)
    const user = userEvent.setup()
    act(() => useUi.getState().setShareNote(note.id))
    const dialog = await screen.findByRole('dialog', { name: '分享' })
    await user.click(await within(dialog).findByRole('button', { name: '建立連結' }))
    await within(dialog).findByLabelText('分享連結')
    // a second link for the same note, as when two devices create one at the same time
    const [first] = [...adapter.rows.values()]
    adapter.rows.set('other-link', { ...first!, id: 'other-link', createdAt: first!.createdAt - 1 })
    adapter.rows.set('someone-else', { ...first!, id: 'someone-else', noteId: 'another-note' })
    await user.click(within(dialog).getByRole('button', { name: '停止分享' }))
    await user.click(within(dialog).getAllByRole('button', { name: '停止分享' }).at(-1)!)
    expect(await within(dialog).findByRole('button', { name: '建立連結' })).toBeInTheDocument()
    expect([...adapter.rows.keys()]).toEqual(['someone-else'])
  })
})

describe('分享對話框：到期、密碼、換新連結', () => {
  async function open() {
    const ctx = await setup()
    show(ctx.services)
    const user = userEvent.setup()
    act(() => useUi.getState().setShareNote(ctx.note.id))
    const dialog = await screen.findByRole('dialog', { name: '分享' })
    await user.click(await within(dialog).findByRole('button', { name: '建立連結' }))
    await within(dialog).findByLabelText('分享連結')
    return { ...ctx, user, dialog, row: () => [...ctx.adapter.rows.values()][0]! }
  }

  it('sets and clears the expiry', async () => {
    const { user, dialog, row } = await open()
    expect(row().expiresAt).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: '到期' }))
    await user.click(await screen.findByRole('menuitem', { name: /7 天/ }))
    await within(dialog).findByText(/到期時間/)
    expect(row().expiresAt).not.toBeNull()
    await user.click(within(dialog).getByRole('button', { name: '到期' }))
    await user.click(await screen.findByRole('menuitem', { name: /永久/ }))
    await waitFor(() => expect(row().expiresAt).toBeNull())
    expect(within(dialog).queryByText(/到期時間/)).toBeNull()
  })

  it('sets, changes and removes the password; a short one is refused', async () => {
    const { user, dialog, row } = await open()
    await user.click(within(dialog).getByRole('checkbox', { name: '密碼' }))
    await user.type(within(dialog).getByLabelText('設定密碼'), 'abc')
    await user.click(within(dialog).getByRole('button', { name: '儲存' }))
    expect(await within(dialog).findByText('密碼至少 6 個字')).toBeInTheDocument()
    expect(row().password).toBeNull()

    await user.clear(within(dialog).getByLabelText('設定密碼'))
    await user.type(within(dialog).getByLabelText('設定密碼'), 'correct horse')
    await user.click(within(dialog).getByRole('button', { name: '儲存' }))
    expect(await within(dialog).findByText('已設定密碼')).toBeInTheDocument()
    const salt = row().password!.saltB64

    await user.click(within(dialog).getByRole('button', { name: '變更' }))
    await user.type(within(dialog).getByLabelText('設定密碼'), 'battery staple')
    await user.click(within(dialog).getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(row().password!.saltB64).not.toBe(salt))

    await user.click(within(dialog).getByRole('checkbox', { name: '密碼' }))
    expect(within(dialog).getByText('移除密碼？知道連結的人就能開啟。')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '移除密碼' }))
    await waitFor(() => expect(row().password).toBeNull())
  }, 60_000)

  it('renewing swaps the link after a confirmation; the old one stops', async () => {
    const { user, dialog, adapter } = await open()
    const old = (within(dialog).getByLabelText('分享連結') as HTMLInputElement).value
    await user.click(within(dialog).getByRole('button', { name: '換新連結' }))
    expect(within(dialog).getByText('換新連結？舊連結將立即失效。')).toBeInTheDocument()
    await user.click(within(dialog).getAllByRole('button', { name: '換新連結' }).at(-1)!)
    await waitFor(() => expect((within(dialog).getByLabelText('分享連結') as HTMLInputElement).value).not.toBe(old))
    expect(adapter.rows.size).toBe(1)
    expect(adapter.rows.has(new URL(old).pathname.split('/').pop()!)).toBe(false)
  })
})

describe('分享 page', () => {
  function showPage(services: AppServices) {
    render(
      <ServicesProvider services={services}>
        <SharesPage />
      </ServicesProvider>,
    )
  }
  const linkOf = (adapter: MemoryShare, pick: (r: MemoryShareRow) => boolean) => [...adapter.rows.values()].find(pick)!

  it('lists single and multi-note links, names unknown notes, and stops one link after a confirmation', async () => {
    const { adapter, services, note } = await setup()
    const b = services.vault.createNote({ title: 'B 篇' })
    show(services)
    const user = userEvent.setup()
    act(() => useUi.getState().setShareNote(note.id))
    await user.click(await screen.findByRole('button', { name: '建立連結' }))
    await screen.findByLabelText('分享連結')
    act(() => useUi.setState({ shareNoteId: null }))
    cleanup()
    const empty = buildShareSnapshot({ title: '別處', doc: doc('x'), sharedAt: 1, linkLabel: () => null })
    const far = await services.share.run((svc) => svc.create('elsewhere', empty))
    await services.share.run(async (svc) => svc.createMulti(await snapshotOfNotes(services, [note.id, b.id])))
    showPage(services)
    expect(await screen.findByText('我的筆記')).toBeInTheDocument()
    expect(screen.getByText('其他裝置的筆記')).toBeInTheDocument()
    expect(screen.getByText('我的筆記、B 篇')).toBeInTheDocument()
    await user.click(screen.getByText('其他裝置的筆記'))
    expect(await screen.findByLabelText('分享連結')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '更新快照' })).toBeNull() // the notes are not on this device
    await user.click(screen.getByRole('button', { name: '停止分享' }))
    expect(screen.getByText('停止分享？連結將立即失效。')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '停止分享' }).at(-1)!)
    await waitFor(() => expect(adapter.rows.has(far.record.id)).toBe(false))
    expect(adapter.rows.size).toBe(2) // the other two stay
    expect(screen.queryByText('其他裝置的筆記')).toBeNull()
  })

  it('makes a link for several notes, in the order of the folder tree, and changes its notes later', async () => {
    const { adapter, services, note } = await setup()
    const b = services.vault.createNote({ title: 'B 篇' })
    const c = services.vault.createNote({ title: 'C 篇' })
    showPage(services)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '建立多篇連結' }))
    expect(screen.getByRole('button', { name: '建立連結' })).toBeDisabled() // at least two
    await user.click(screen.getByLabelText('C 篇'))
    await user.click(screen.getByLabelText('我的筆記'))
    expect(screen.getByText(/已選 2／30/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '建立連結' }))
    await screen.findByLabelText('分享連結')
    const made = linkOf(adapter, (r) => r.noteIds !== null)
    expect(new Set(made.noteIds)).toEqual(new Set([note.id, c.id]))
    expect(made.noteId).toBe(made.noteIds![0])
    // change the notes: add B
    await user.click(screen.getByRole('button', { name: '變更筆記' }))
    await user.click(screen.getByLabelText('B 篇'))
    await user.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(linkOf(adapter, (r) => r.noteIds !== null).noteIds).toHaveLength(3))
    expect(new Set(linkOf(adapter, (r) => r.noteIds !== null).noteIds)).toEqual(new Set([note.id, b.id, c.id]))
    expect(screen.getByLabelText('分享連結')).toBeInTheDocument()
  })

  it('searches the notes and stops at 30', async () => {
    const { services } = await setup()
    for (let i = 0; i < 31; i++) services.vault.createNote({ title: `多 ${String(i).padStart(2, '0')}` })
    showPage(services)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '建立多篇連結' }))
    await user.type(screen.getByLabelText('搜尋筆記'), '我的')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    await user.clear(screen.getByLabelText('搜尋筆記'))
    for (const box of screen.getAllByRole('checkbox').slice(0, 30)) await user.click(box)
    expect(screen.getByText(/已選 30／30/)).toBeInTheDocument()
    const unchecked = screen.getAllByRole('checkbox').filter((b) => !(b as HTMLInputElement).checked)
    expect(unchecked.length).toBeGreaterThanOrEqual(2)
    expect(unchecked.every((b) => (b as HTMLInputElement).disabled)).toBe(true)
  })

  it('signed out: asks to sign in', async () => {
    const { services } = await setup(false)
    showPage(services)
    expect(await screen.findByText('登入後即可分享')).toBeInTheDocument()
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

  it('content the page cannot show gives a message, never a blank page', async () => {
    const { adapter, svc } = await link()
    const hostile = (d: unknown) => ({ v: 1 as const, title: '壞的', sharedAt: 1, doc: d as never })
    const cases: unknown[] = [
      { type: 'doc', content: [{ type: 'mystery' }, { type: 'paragraph', content: [{ type: 'text', text: '還在' }] }] },
      { type: 'doc', content: [{ type: 'media', attrs: { attachmentId: 'a', kind: 'image' } }] },
      { type: 'doc', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }, // structurally wrong
    ]
    for (const [i, d] of cases.entries()) {
      const { url } = await svc.create(`bad${i}`, hostile(d))
      at(new URL(url))
      const { unmount } = render(<SharePage adapter={adapter} />)
      await waitFor(() => expect(document.body.textContent?.trim()).not.toBe(''))
      await screen.findByText(/還在|附件未包含|無法開啟此連結/)
      unmount()
    }
  })

  it('a script link or odd colour in a shared note never reaches the page', async () => {
    const { adapter, svc } = await link()
    const bad = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '點我', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'textStyle', attrs: { color: 'url(//e.example)' } }] },
          ],
        },
      ],
    }
    const { url } = await svc.create('evil', { v: 1, title: 't', sharedAt: 1, doc: bad as never })
    at(new URL(url))
    render(<SharePage adapter={adapter} />)
    const body = await screen.findByLabelText('筆記內容')
    expect(body).toHaveTextContent('點我')
    expect(body.innerHTML).not.toMatch(/javascript:|url\(/)
    expect(body.querySelector('a')).toBeNull()
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

  it('asks for the password, says when it is wrong, opens when right', async () => {
    const { adapter, svc, url } = await link()
    const [record] = await svc.listForNote('n1')
    await svc.setPassword(record!.id, 'open sesame')
    at(url)
    render(<SharePage adapter={adapter} />)
    const user = userEvent.setup()
    expect(await screen.findByText('此文件受到密碼保護。請輸入密碼以開啟文件。')).toBeInTheDocument()
    expect(screen.queryByText('公開的筆記')).toBeNull()
    await user.type(screen.getByLabelText('密碼'), 'wrong one')
    await user.click(screen.getByRole('button', { name: '開啟' }))
    expect(await screen.findByText('密碼錯誤')).toBeInTheDocument()
    await user.type(screen.getByLabelText('密碼'), 'open sesame')
    await user.click(screen.getByRole('button', { name: '開啟' }))
    expect(await screen.findByRole('heading', { name: '公開的筆記' })).toBeInTheDocument()
  }, 60_000)

  it('an expired link says so', async () => {
    const { adapter, svc, url } = await link()
    const [record] = await svc.listForNote('n1')
    await svc.setExpiry(record!.id, 60)
    adapter.rows.get(record!.id)!.expiresAt = Date.now() - 1000
    at(url)
    render(<SharePage adapter={adapter} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('連結已過期')
  })

  it('shows the outline for a note with headings, and none without', async () => {
    const { adapter, svc } = await link()
    const withHeadings = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, id: 'h-a' }, content: [{ type: 'text', text: '第一章' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '內文' }] },
        { type: 'heading', attrs: { level: 2, id: 'h-b' }, content: [{ type: 'text', text: '小節' }] },
      ],
    }
    const { url } = await svc.create('with-h', { v: 1, title: '有大綱', sharedAt: 1, doc: withHeadings as never })
    at(new URL(url))
    const { unmount } = render(<SharePage adapter={adapter} />)
    await screen.findByLabelText('筆記內容')
    expect(screen.getByRole('button', { name: '大綱' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: '大綱', hidden: true })
    expect(within(nav).getAllByRole('button', { hidden: true }).map((b) => b.textContent)).toEqual(['有大綱', '第一章', '小節'])
    unmount()
    const plain = await svc.create('no-h', { v: 1, title: '沒大綱', sharedAt: 1, doc: doc('只有段落') })
    at(new URL(plain.url))
    render(<SharePage adapter={adapter} />)
    await screen.findByLabelText('筆記內容')
    expect(screen.queryByRole('button', { name: '大綱' })).toBeNull()
  })

  describe('multi-note link', () => {
    const para = (...content: unknown[]) => ({ type: 'paragraph', content })
    const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks && { marks }) })
    async function multi() {
      const adapter = new MemoryShare()
      const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      const svc = createShareService({ adapter, account: () => ({ userId: 'u', vaultId: 'v', kek }), origin: 'https://notes.test' })
      const label = (id: string) => ({ A: 'A 篇', B: 'B 篇', C: 'C 篇' }[id] ?? null)
      const docs = {
        A: {
          type: 'doc',
          content: [
            para(t('去 '), { type: 'noteLink', attrs: { noteId: 'B', blockId: 'blk-b2' } }, t('，也看 '), { type: 'noteLink', attrs: { noteId: 'OUT', blockId: null, label: '沒分享的' } }),
            para(t('外部', [{ type: 'link', attrs: { href: 'https://example.com/x' } }])),
          ],
        },
        B: { type: 'doc', content: [para(t('B 的內容')), { type: 'paragraph', attrs: { id: 'blk-b2' }, content: [t('B 的第二段')] }] },
        C: { type: 'doc', content: [para(t('C 的內容'))] },
      }
      const snapshot = buildMultiShareSnapshot({
        notes: (['A', 'B', 'C'] as const).map((noteId) => ({ noteId, title: label(noteId)!, doc: docs[noteId] as never })),
        sharedAt: 1,
        linkLabel: (id, blockId) => (label(id) ? (blockId ? `${label(id)} › B 的第二段` : label(id)) : null),
      })
      const { url } = await svc.createMulti({ noteIds: ['A', 'B', 'C'], snapshot })
      return { adapter, url: new URL(url) }
    }
    // jsdom has no layout: the editor looks for the element under a click
    beforeEach(() => {
      document.elementFromPoint = vi.fn(() => null)
    })
    const atWith = (u: URL, query = '') => window.history.replaceState(null, '', `${u.pathname}${query}${u.hash}`)

    it('lists the notes, shows the first, and switches with the list and with links between the notes', async () => {
      const { adapter, url } = await multi()
      atWith(url)
      render(<SharePage adapter={adapter} />)
      const user = userEvent.setup()
      const nav = await screen.findByRole('navigation', { name: '筆記清單' })
      expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['A 篇', 'B 篇', 'C 篇'])
      expect(await screen.findByRole('heading', { name: 'A 篇' })).toBeInTheDocument()
      expect(within(nav).getByRole('button', { name: 'A 篇' })).toHaveAttribute('aria-current', 'page')
      // a link to a note outside the link is plain text; an outside link opens as usual
      const body = screen.getByLabelText('筆記內容')
      expect(body).toHaveTextContent('沒分享的')
      expect(screen.queryByRole('link', { name: /沒分享的/ })).toBeNull()
      expect(body.querySelector('a')).toHaveAttribute('href', 'https://example.com/x')
      // a link to another note of the link switches to it and the address remembers it
      await user.click(screen.getByRole('link', { name: '前往 B 篇 › B 的第二段' }))
      expect(await screen.findByRole('heading', { name: 'B 篇' })).toBeInTheDocument()
      expect(screen.getByLabelText('筆記內容')).toHaveTextContent('B 的第二段')
      expect(window.location.search).toBe('?n=n1')
      expect(window.location.hash).toBe(url.hash)
      await user.click(within(nav).getByRole('button', { name: 'C 篇' }))
      expect(await screen.findByRole('heading', { name: 'C 篇' })).toBeInTheDocument()
      expect(window.location.search).toBe('?n=n2')
      await user.click(within(nav).getByRole('button', { name: 'A 篇' }))
      expect(await screen.findByRole('heading', { name: 'A 篇' })).toBeInTheDocument()
      expect(window.location.search).toBe('')
    })

    it('opens on the note named in the address, and falls back to the first for a bad one', async () => {
      const { adapter, url } = await multi()
      atWith(url, '?n=n2')
      const { unmount } = render(<SharePage adapter={adapter} />)
      expect(await screen.findByRole('heading', { name: 'C 篇' })).toBeInTheDocument()
      unmount()
      for (const bad of ['?n=n9', '?n=', '?n=__proto__', '?n=<script>']) {
        atWith(url, bad)
        const r = render(<SharePage adapter={adapter} />)
        expect(await screen.findByRole('heading', { name: 'A 篇' })).toBeInTheDocument()
        r.unmount()
      }
    })

    it('a protected multi-note link shows no title or list before the password', async () => {
      const { adapter, url } = await multi()
      const [row] = [...adapter.rows.values()]
      expect(row.noteIds).toEqual(['A', 'B', 'C'])
      adapter.rows.get(row.id)!.password = { saltB64: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: 600_000, pwKey: 'x' }
      adapter.rows.get(row.id)!.verifier = new Uint8Array(32)
      atWith(url)
      render(<SharePage adapter={adapter} />)
      expect(await screen.findByText('此文件受到密碼保護。請輸入密碼以開啟文件。')).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: '筆記清單' })).toBeNull()
      expect(screen.queryByText('A 篇')).toBeNull()
    })
  })
})
