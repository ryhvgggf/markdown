import { useSyncExternalStore } from 'react'
import { useServices } from '@/app/services-context'
import { buildTree, type TreeNode } from '@/core/vault/tree'
import type { FolderMeta, NoteMeta } from '@/core/vault/types'
import type { Vault } from '@/core/vault/vault'

export type VaultSnapshot = {
  notes: NoteMeta[]
  folders: FolderMeta[]
  tree: TreeNode[]
  trashed: { notes: NoteMeta[]; folders: FolderMeta[] }
}

function compute(vault: Vault): VaultSnapshot {
  const allNotes = vault.listNotes({ includeTrashed: true })
  const allFolders = vault.listFolders({ includeTrashed: true })
  return {
    notes: allNotes.filter((n) => n.deletedAt === null),
    folders: allFolders.filter((f) => f.deletedAt === null),
    tree: buildTree(allFolders, allNotes),
    trashed: {
      notes: allNotes.filter((n) => n.deletedAt !== null),
      folders: allFolders.filter((f) => f.deletedAt !== null),
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

/** Trash entries that were trashed on their own: items inside a trashed folder travel with it. */
export function trashRoots(t: VaultSnapshot['trashed']): Array<{ kind: 'note'; note: NoteMeta } | { kind: 'folder'; folder: FolderMeta }> {
  const trashedFolders = new Set(t.folders.map((f) => f.id))
  return [
    ...t.folders.filter((f) => f.parentId === null || !trashedFolders.has(f.parentId)).map((folder) => ({ kind: 'folder' as const, folder })),
    ...t.notes.filter((n) => n.folderId === null || !trashedFolders.has(n.folderId)).map((note) => ({ kind: 'note' as const, note })),
  ].sort((a, b) => (b.kind === 'note' ? b.note.deletedAt! : b.folder.deletedAt!) - (a.kind === 'note' ? a.note.deletedAt! : a.folder.deletedAt!))
}
