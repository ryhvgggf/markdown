import * as Y from 'yjs'
import type { StorageAdapter, StorageError } from '@/adapters/storage/types'
import { bindPersistence, type PersistBinding } from '../persist'
import { TAB_ORIGIN, connectTabs } from '../tabs-bridge'
import { ACCENTS } from './accents'

export type Tri = 'system' | 'on' | 'off'
export type Prefs = {
  accent: string
  /** The note card's own background image (the page behind it stays the fixed default). */
  noteBackgroundBlobId: string | null
  /** 0 (invisible, card stays its plain colour) – 1 (image fully visible). User-adjusted only. */
  noteBackgroundOpacity: number
  fontSize: 'small' | 'standard' | 'large'
  lineHeight: 'compact' | 'standard' | 'relaxed'
  editorWidth: 'narrow' | 'standard' | 'wide'
  railMode: 'hover' | 'pinned'
  sidebarWidth: number
  panelWidth: number
  reduceMotion: Tri
  reduceTransparency: Tri
}

export const DEFAULT_PREFS: Prefs = {
  accent: '#4F4BC9',
  noteBackgroundBlobId: null,
  noteBackgroundOpacity: 1,
  fontSize: 'standard',
  lineHeight: 'standard',
  editorWidth: 'standard',
  railMode: 'hover',
  sidebarWidth: 256,
  panelWidth: 300,
  reduceMotion: 'system',
  reduceTransparency: 'system',
}

export interface PreferencesOpenOptions {
  channelFactory?: (name: string) => BroadcastChannel
  onStorageError?: (e: StorageError) => void
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const RANGES: Partial<Record<keyof Prefs, [number, number]>> = {
  sidebarWidth: [220, 360],
  panelWidth: [280, 420],
  noteBackgroundOpacity: [0, 1],
}
const ENUMS: Partial<Record<keyof Prefs, readonly string[]>> = {
  fontSize: ['small', 'standard', 'large'],
  lineHeight: ['compact', 'standard', 'relaxed'],
  editorWidth: ['narrow', 'standard', 'wide'],
  railMode: ['hover', 'pinned'],
  reduceMotion: ['system', 'on', 'off'],
  reduceTransparency: ['system', 'on', 'off'],
}

function valid(key: keyof Prefs, v: unknown): boolean {
  const range = RANGES[key]
  if (range) return typeof v === 'number' && Number.isFinite(v)
  const en = ENUMS[key]
  if (en) return typeof v === 'string' && en.includes(v)
  if (key === 'noteBackgroundBlobId') return v === null || typeof v === 'string'
  if (key === 'accent') return canonicalAccent(v) !== null
  return typeof v === 'string' && v !== ''
}

function canonicalAccent(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return ACCENTS.find((a) => a.hex.toLowerCase() === v.toLowerCase())?.hex ?? null
}

export class Preferences {
  readonly doc: Y.Doc
  private readonly map: Y.Map<unknown>
  private readonly teardown: Array<() => void>

  private constructor(
    private readonly docId: string,
    doc: Y.Doc,
    private readonly binding: PersistBinding,
    teardown: Array<() => void>,
  ) {
    this.doc = doc
    this.teardown = teardown
    this.map = doc.getMap('prefs')
  }

  static async open(storage: StorageAdapter, userId = 'local', opts: PreferencesOpenOptions = {}): Promise<Preferences> {
    const docId = `prefs:${userId}`
    const doc = new Y.Doc()
    const teardown: Array<() => void> = []
    const binding = await bindPersistence(doc, docId, storage, {
      ignoreOrigins: [TAB_ORIGIN],
      onError: opts.onStorageError,
    })
    teardown.push(() => binding.destroy())
    if (opts.channelFactory || typeof BroadcastChannel !== 'undefined') {
      teardown.push(connectTabs(doc, docId, opts.channelFactory))
    }
    return new Preferences(docId, doc, binding, teardown)
  }

  get(): Prefs {
    const out: Record<string, unknown> = { ...DEFAULT_PREFS }
    for (const key of Object.keys(DEFAULT_PREFS) as Array<keyof Prefs>) {
      const v = this.map.get(key)
      if (v === undefined || !valid(key, v)) continue
      const range = RANGES[key]
      out[key] = range ? clamp(v as number, range[0], range[1]) : key === 'accent' ? canonicalAccent(v) : v
    }
    return out as Prefs
  }

  set(patch: Partial<Prefs>): void {
    this.doc.transact(() => {
      for (const key of Object.keys(patch) as Array<keyof Prefs>) {
        if (!(key in DEFAULT_PREFS)) continue
        let v: unknown = patch[key]
        if (v === undefined) continue
        const range = RANGES[key]
        if (range && typeof v === 'number' && Number.isFinite(v)) v = clamp(v, range[0], range[1])
        this.map.set(key, v)
      }
    })
  }

  observe(cb: (p: Prefs) => void): () => void {
    const handler = () => cb(this.get())
    this.map.observe(handler)
    return () => this.map.unobserve(handler)
  }

  hasPendingWrites(): boolean {
    return this.binding.hasPending()
  }

  /** Hands not-yet-stored updates to `stash` (synchronous; used on pagehide). */
  stashUnsaved(stash: (docId: string, update: Uint8Array) => void): void {
    const u = this.binding.pendingUpdate()
    if (u) stash(this.docId, u)
  }

  close(): void {
    this.teardown.reverse().forEach((t) => t())
    this.teardown.length = 0
  }
}
