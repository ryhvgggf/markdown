import { useSyncExternalStore } from 'react'
import { useServices } from '@/app/services-context'
import { buildTree, type TreeNode } from '@/core/vault/tree'
import type { AttachmentMeta, FolderMeta, NoteMeta } from '@/core/vault/types'
import type { Vault } from '@/core/vault/vault'

export type VaultSnapshot = {
  notes: NoteMeta[]
  folders: FolderMeta[]
  tree: TreeNode[]
  /** Live (not trashed) attachments. */
  attachments: AttachmentMeta[]
  trashed: { notes: NoteMeta[]; folders: FolderMeta[]; attachments: AttachmentMeta[] }
}

function compute(vault: Vault): VaultSnapshot {
  const allNotes = vault.listNotes({ includeTrashed: true })
  const allFolders = vault.listFolders({ includeTrashed: true })
  const allAttachments = vault.listAttachments({ includeTrashed: true })
  return {
    notes: allNotes.filter((n) => n.deletedAt === null),
    folders: allFolders.filter((f) => f.deletedAt === null),
    tree: buildTree(allFolders, allNotes),
    attachments: allAttachments.filter((a) => a.deletedAt === null),
    trashed: {
      notes: allNotes.filter((n) => n.deletedAt !== null),
      folders: allFolders.filter((f) => f.deletedAt !== null),
      attachments: allAttachments.filter((a) => a.deletedAt !== null),
    },
  }
}

class Store {
  snap: VaultSnapshot
  constructor(private readonly vault: Vault) {
    this.snap = compute(vault)
  }
  subscribe = (cb: () => void) => {
    const off = this.vault.observe(() => {
      this.snap = compute(this.vault)
      cb()
    })
    this.snap = compute(this.vault) // catch changes made between render and subscribe
    return off
  }
  getSnapshot = () => this.snap
}
const stores = new WeakMap<Vault, Store>()
const storeFor = (v: Vault) => {
  let s = stores.get(v)
  if (!s) stores.set(v, (s = new Store(v)))
  return s
}

export function useVaultSnapshot(): VaultSnapshot {
  const { vault } = useServices()
  const store = storeFor(vault)
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export type TrashItem =
  | { kind: 'note'; note: NoteMeta }
  | { kind: 'folder'; folder: FolderMeta }
  | { kind: 'attachment'; attachment: AttachmentMeta }

const trashedAt = (i: TrashItem) => (i.kind === 'note' ? i.note.deletedAt : i.kind === 'folder' ? i.folder.deletedAt : i.attachment.deletedAt) ?? 0

/** Trash entries that were trashed on their own (items inside a trashed folder travel with it), newest first. */
export function trashRoots(t: VaultSnapshot['trashed']): TrashItem[] {
  const trashedFolders = new Set(t.folders.map((f) => f.id))
  return [
    ...t.folders.filter((f) => f.parentId === null || !trashedFolders.has(f.parentId)).map((folder) => ({ kind: 'folder' as const, folder })),
    ...t.notes.filter((n) => n.folderId === null || !trashedFolders.has(n.folderId)).map((note) => ({ kind: 'note' as const, note })),
    ...(t.attachments ?? []).map((attachment) => ({ kind: 'attachment' as const, attachment })),
  ].sort((a, b) => trashedAt(b) - trashedAt(a))
}
