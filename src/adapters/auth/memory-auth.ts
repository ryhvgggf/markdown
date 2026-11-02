import { newId } from '@/core/ids'
import { AuthError, type AuthAdapter, type AuthUser } from './types'

/** In-memory fake `AuthAdapter` for tests, matching `adapters/storage/memory-storage.ts`'s pattern. */
export class MemoryAuth implements AuthAdapter {
  private usersByEmail = new Map<string, { userId: string; password: string; confirmed: boolean }>()
  private currentUserId: string | null = null
  private recoveryListeners = new Set<() => void>()
  /** Emails with a pending reset request (test hook — `requestPasswordReset` is otherwise a no-op here). */
  readonly resetRequested = new Set<string>()

  /** `requireConfirmation`: behave like Supabase with "Confirm email" on. */
  constructor(private opts: { requireConfirmation?: boolean } = {}) {}

  async signUp(email: string, password: string): Promise<{ userId: string; needsConfirmation: boolean }> {
    if (this.usersByEmail.has(email)) throw new AuthError('email-taken', `email already registered: ${email}`)
    const userId = newId()
    const needsConfirmation = !!this.opts.requireConfirmation
    this.usersByEmail.set(email, { userId, password, confirmed: !needsConfirmation })
    if (!needsConfirmation) this.currentUserId = userId
    return { userId, needsConfirmation }
  }

  /** Test hook: the user followed the confirmation link (Supabase then signs them in on that page). */
  confirmEmail(email: string): void {
    const record = this.usersByEmail.get(email)
    if (!record) return
    record.confirmed = true
    this.currentUserId = record.userId
  }

  async signIn(email: string, password: string): Promise<{ userId: string }> {
    const record = this.usersByEmail.get(email)
    if (!record || record.password !== password) throw new AuthError('invalid-credentials', 'wrong email or password')
    if (!record.confirmed) throw new AuthError('email-not-confirmed', 'email not confirmed')
    this.currentUserId = record.userId
    return { userId: record.userId }
  }

  async signOut(): Promise<void> {
    this.currentUserId = null
  }

  async getCurrentUserId(): Promise<string | null> {
    return this.currentUserId
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    for (const [email, r] of this.usersByEmail) if (r.userId === this.currentUserId) return { userId: r.userId, email }
    return null
  }

  async requestPasswordReset(email: string): Promise<void> {
    if (this.usersByEmail.has(email)) this.resetRequested.add(email)
    // Real adapter: always resolves successfully regardless of whether the email exists, so this fake
    // does too — it must not leak which emails are registered.
  }

  /** Test hook: the user followed the reset link — signed in as them, recovery event fired. */
  openResetLink(email: string): void {
    const record = this.usersByEmail.get(email)
    if (!record) return
    this.currentUserId = record.userId
    this.recoveryListeners.forEach((l) => l())
  }

  async setPassword(newPassword: string): Promise<void> {
    if (!this.currentUserId) throw new AuthError('not-authenticated', 'no signed-in user')
    for (const record of this.usersByEmail.values()) {
      if (record.userId === this.currentUserId) record.password = newPassword
    }
  }

  onPasswordRecovery(cb: () => void): () => void {
    this.recoveryListeners.add(cb)
    return () => void this.recoveryListeners.delete(cb)
  }
}
