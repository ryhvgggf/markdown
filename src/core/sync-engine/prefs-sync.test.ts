import { afterEach, describe, expect, it } from 'vitest'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { DEFAULT_PREFS, Preferences } from '@/core/preferences/preferences'
import { bindPrefsSync, prefsDocId, type PrefsSyncBinding } from './prefs-sync'

const isolated = () =>
  ({ postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {} }) as unknown as BroadcastChannel
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 1500) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await wait(10)
  }
}

let sync: MemorySync
let kek: CryptoKey
const open: Array<{ prefs: Preferences; binding?: PrefsSyncBinding }> = []

async function device(name: string, initial: Parameters<Preferences['set']>[0] = {}) {
  const prefs = await Preferences.open(new MemoryStorage(), 'local', { channelFactory: isolated })
  prefs.set(initial)
  const entry: { prefs: Preferences; binding?: PrefsSyncBinding } = { prefs }
  open.push(entry)
  return {
    prefs,
    connect: async () => {
      entry.binding = await bindPrefsSync(prefs, { sync, vaultId: 'v1', kek, deviceId: name })
      return entry.binding
    },
  }
}

afterEach(async () => {
  for (const d of open.splice(0)) {
    await d.binding?.close()
    d.prefs.close()
  }
})

async function setup() {
  sync = new MemorySync()
  kek = await generateKek()
}

describe('appearance settings sync (3f-4)', () => {
  it('a change on one device reaches the other', async () => {
    await setup()
    const a = await device('A')
    const b = await device('B')
    await a.connect()
    await b.connect()
    a.prefs.set({ accent: '#1F63D6', fontSize: 'large', sidebarSort: 'modified' })
    await until(() => b.prefs.get().fontSize === 'large')
    expect(b.prefs.get()).toMatchObject({ accent: '#1F63D6', fontSize: 'large', sidebarSort: 'modified' })
    b.prefs.set({ editorWidth: 'wide' })
    await until(() => a.prefs.get().editorWidth === 'wide')
  })

  it('a new device takes on the account\'s look on connect, and uploads only what the account lacks', async () => {
    await setup()
    const a = await device('A', { fontSize: 'large', accent: '#1F63D6' })
    await a.connect()
    await wait()
    const b = await device('B', { fontSize: 'small', lineHeight: 'relaxed' }) // fontSize clashes, lineHeight is new
    await b.connect()
    expect(b.prefs.get().fontSize).toBe('large') // the account wins
    expect(b.prefs.get().accent).toBe('#1F63D6')
    await until(() => a.prefs.get().lineHeight === 'relaxed') // what only B had goes up
    expect(a.prefs.get().fontSize).toBe('large')
  })

  it('a device that never touched a setting does not overwrite another device\'s choice with its default', async () => {
    await setup()
    const a = await device('A', { railMode: 'pinned' })
    const b = await device('B')
    await a.connect()
    await b.connect()
    await until(() => b.prefs.get().railMode === 'pinned')
    b.prefs.set({ fontSize: 'large' }) // an unrelated change on B
    await until(() => a.prefs.get().fontSize === 'large')
    expect(a.prefs.get().railMode).toBe('pinned')
  })

  it('keeps the background image, its opacity, widths and reduce-motion/transparency on each device', async () => {
    await setup()
    const a = await device('A', {
      noteBackgroundBlobId: 'blob-a',
      noteBackgroundOpacity: 0.4,
      sidebarWidth: 300,
      panelWidth: 400,
      reduceMotion: 'on',
      reduceTransparency: 'on',
      fontSize: 'large',
    })
    const b = await device('B')
    await a.connect()
    await b.connect()
    await until(() => b.prefs.get().fontSize === 'large')
    expect(b.prefs.get()).toMatchObject({
      noteBackgroundBlobId: DEFAULT_PREFS.noteBackgroundBlobId,
      noteBackgroundOpacity: DEFAULT_PREFS.noteBackgroundOpacity,
      sidebarWidth: DEFAULT_PREFS.sidebarWidth,
      panelWidth: DEFAULT_PREFS.panelWidth,
      reduceMotion: 'system',
      reduceTransparency: 'system',
    })
  })

  it('ignores invalid values from the account', async () => {
    await setup()
    const a = await device('A')
    a.prefs.applyRemote({ fontSize: 'gigantic', accent: 'not-a-colour', railMode: 'pinned', noteBackgroundBlobId: 'x' })
    expect(a.prefs.explicit()).toEqual({ railMode: 'pinned' })
  })

  it('travels encrypted under the vault\'s prefs doc id', async () => {
    await setup()
    const a = await device('A', { fontSize: 'large' })
    await a.connect()
    await wait()
    expect(await sync.listDocs('v1')).toContain(prefsDocId('v1'))
    const chunks = await sync.pullDoc('v1', prefsDocId('v1'))
    expect(new TextDecoder().decode(chunks[0])).not.toContain('large')
  })
})
