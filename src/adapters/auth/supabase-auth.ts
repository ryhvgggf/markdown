import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError, type AuthAdapter } from './types'

/** Real `AuthAdapter`, backed by Supabase Auth (email + password only — design doc §2). */
export class SupabaseAuth implements AuthAdapter {
  constructor(private client: SupabaseClient) {}

  async signUp(email: string, password: string): Promise<{ userId: string }> {
    const { data, error } = await this.client.auth.signUp({ email, password })
    if (error) throw toAuthError(error)
    if (!data.user) throw new AuthError('unknown', 'sign-up succeeded but returned no user')
    return { userId: data.user.id }
  }

  async signIn(email: string, password: string): Promise<{ userId: string }> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password })
    if (error) throw toAuthError(error)
    return { userId: data.user.id }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (error) throw toAuthError(error)
  }

  async getCurrentUserId(): Promise<string | null> {
    const { data } = await this.client.auth.getSession()
    return data.session?.user.id ?? null
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email)
    if (error) throw toAuthError(error)
  }

  async setPassword(newPassword: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password: newPassword })
    if (error) throw toAuthError(error)
  }
}

function toAuthError(e: { message: string; status?: number; code?: string }): AuthError {
  if (e.code === 'user_already_exists' || e.status === 422) return new AuthError('email-taken', e.message, { cause: e })
  if (e.code === 'invalid_credentials' || e.status === 400) return new AuthError('invalid-credentials', e.message, { cause: e })
  return new AuthError('unknown', e.message, { cause: e })
}
