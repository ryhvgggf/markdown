import { newId } from '@/core/ids'
import { AuthError, type AuthAdapter } from './types'

/** In-memory fake `AuthAdapter` for tests, matching `adapters/storage/memory-storage.ts`'s pattern. */
export class MemoryAuth implements AuthAdapter {
  private usersByEmail = new Map<string, { userId: string; password: string }>()
  private currentUserId: string | null = null
  /** Emails with a pending reset request (test hook — `requestPasswordReset` is otherwise a no-op here). */
  readonly resetRequested = new Set<string>()

  async signUp(email: string, password: string): Promise<{ userId: string }> {
    if (this.usersByEmail.has(email)) throw new AuthError('email-taken', `email already registered: ${email}`)
    const userId = newId()
    this.usersByEmail.set(email, { userId, password })
    this.currentUserId = userId
    return { userId }
  }

  async signIn(email: string, password: string): Promise<{ userId: string }> {
    const record = this.usersByEmail.get(email)
    if (!record || record.password !== password) throw new AuthError('invalid-credentials', 'wrong email or password')
    this.currentUserId = record.userId
    return { userId: record.userId }
  }

  async signOut(): Promise<void> {
    this.currentUserId = null
  }

  async getCurrentUserId(): Promise<string | null> {
    return this.currentUserId
  }

  async requestPasswordReset(email: string): Promise<void> {
    if (this.usersByEmail.has(email)) this.resetRequested.add(email)
    // Real adapter: always resolves successfully regardless of whether the email exists, so this fake
    // does too — it must not leak which emails are registered.
  }

  async setPassword(newPassword: string): Promise<void> {
    if (!this.currentUserId) throw new AuthError('not-authenticated', 'no signed-in user')
    for (const record of this.usersByEmail.values()) {
      if (record.userId === this.currentUserId) record.password = newPassword
    }
  }
}
