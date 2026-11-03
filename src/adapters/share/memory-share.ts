import { ShareError, type NewShare, type ShareAdapter, type ShareRecord } from './types'

/** In-memory `ShareAdapter` for tests and e2e (one account; `now` is injectable). */
export class MemoryShare implements ShareAdapter {
  readonly rows = new Map<string, ShareRecord & { userId: string; ciphertext: Uint8Array }>()
  constructor(private now: () => number = Date.now) {}

  async create(s: NewShare): Promise<void> {
    if (this.rows.has(s.id)) throw new ShareError('unknown', 'duplicate share id')
    const t = this.now()
    this.rows.set(s.id, { ...s, ciphertext: s.ciphertext.slice(), createdAt: t, updatedAt: t })
  }
  async update(id: string, ciphertext: Uint8Array): Promise<void> {
    const row = this.rows.get(id)
    if (!row) throw new ShareError('not-found')
    row.ciphertext = ciphertext.slice()
    row.updatedAt = this.now()
  }
  async remove(id: string): Promise<void> {
    this.rows.delete(id)
  }
  async removeForNote(vaultId: string, noteId: string): Promise<void> {
    for (const [id, r] of this.rows) if (r.vaultId === vaultId && r.noteId === noteId) this.rows.delete(id)
  }
  async listForNote(vaultId: string, noteId: string): Promise<ShareRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.vaultId === vaultId && r.noteId === noteId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, vaultId, noteId, wrappedKey, createdAt, updatedAt }) => ({ id, vaultId, noteId, wrappedKey, createdAt, updatedAt }))
  }
  async getPublic(id: string): Promise<Uint8Array | null> {
    return this.rows.get(id)?.ciphertext.slice() ?? null
  }
}
