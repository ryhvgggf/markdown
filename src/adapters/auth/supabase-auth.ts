import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError, type AuthAdapter, type AuthUser } from './types'

/** Real `AuthAdapter`, backed by Supabase Auth (email + password only — design doc §2). */
export class SupabaseAuth implements AuthAdapter {
  private recoveryListeners = new Set<() => void>()
  private recoveryPending: boolean

  /**
   * Subscribe as soon as the client exists: supabase-js reads a reset link's tokens from the URL while it
   * initialises and fires PASSWORD_RECOVERY once, which a listener added later would miss. `recoveryUrl`
   * (the URL hash said `type=recovery`) is a fallback for the same thing.
   */
  constructor(
    private client: SupabaseClient,
    opts: { recoveryUrl?: boolean } = {},
  ) {
    this.recoveryPending = !!opts.recoveryUrl
    client.auth.onAuthStateChange((event) => {
      if (event !== 'PASSWORD_RECOVERY') return
      if (this.recoveryListeners.size === 0) this.recoveryPending = true
      else this.recoveryListeners.forEach((l) => l())
    })
  }

  async signUp(email: string, password: string, opts?: { redirectTo?: string }): Promise<{ userId: string; needsConfirmation: boolean }> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: opts?.redirectTo ? { emailRedirectTo: opts.redirectTo } : undefined,
    })
    if (error) throw toAuthError(error)
    if (!data.user) throw new AuthError('unknown', 'sign-up succeeded but returned no user')
    // With "Confirm email" on, an address that is already registered comes back as a user with no
    // identities (Supabase hides which emails exist); it gets the same "check your email" answer.
    return { userId: data.user.id, needsConfirmation: !data.session }
  }

  async signIn(email: string, password: string): Promise<{ userId: string }> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw toAuthError(error)
    return { userId: data.user.id }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: 'local' })
    if (error) throw toAuthError(error)
  }

  async getCurrentUserId(): Promise<string | null> {
    return (await this.getCurrentUser())?.userId ?? null
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const { data } = await this.client.auth.getSession()
    const user = data.session?.user
    return user ? { userId: user.id, email: user.email ?? '' } : null
  }

  async requestPasswordReset(email: string, opts?: { redirectTo?: string }): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, opts?.redirectTo ? { redirectTo: opts.redirectTo } : undefined)
    if (error) throw toAuthError(error)
  }

  async setPassword(newPassword: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password: newPassword })
    if (error) throw toAuthError(error)
  }

  onPasswordRecovery(cb: () => void): () => void {
    this.recoveryListeners.add(cb)
    if (this.recoveryPending) {
      this.recoveryPending = false
      queueMicrotask(cb)
    }
    return () => void this.recoveryListeners.delete(cb)
  }
}

/** Maps Supabase Auth error codes; HTTP status alone is ambiguous (400 is both wrong password and unconfirmed email). */
export function toAuthError(e: { message: string; status?: number; code?: string; name?: string }): AuthError {
  const code = e.code ?? ''
  if (code === 'user_already_exists' || code === 'email_exists') return new AuthError('email-taken', e.message, { cause: e })
  if (code === 'email_not_confirmed') return new AuthError('email-not-confirmed', e.message, { cause: e })
  if (code === 'weak_password') return new AuthError('weak-password', e.message, { cause: e })
  if (code === 'invalid_credentials') return new AuthError('invalid-credentials', e.message, { cause: e })
  if (code.startsWith('over_') || e.status === 429) return new AuthError('rate-limited', e.message, { cause: e })
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return new AuthError('offline', e.message, { cause: e })
  if (!code && e.status === 400) return new AuthError('invalid-credentials', e.message, { cause: e })
  return new AuthError('unknown', e.message, { cause: e })
}
