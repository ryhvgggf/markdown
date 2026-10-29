/**
 * `adapters/auth` — account sign-up/sign-in, wrapping Supabase Auth (design doc §6). Deliberately thin:
 * this adapter only proves identity (who is this email?); the knowledge-base encryption key never passes
 * through it — see `core/account` and `adapters/crypto`/`adapters/key-store` for that.
 */

export interface AuthAdapter {
  signUp(email: string, password: string): Promise<{ userId: string }>
  signIn(email: string, password: string): Promise<{ userId: string }>
  signOut(): Promise<void>
  getCurrentUserId(): Promise<string | null>
  /** Triggers Supabase's standard "reset password" email flow. */
  requestPasswordReset(email: string): Promise<void>
  /** Sets a new password for the current session (called after the user follows the reset-password link). */
  setPassword(newPassword: string): Promise<void>
}

export type AuthErrorKind = 'invalid-credentials' | 'email-taken' | 'not-authenticated' | 'unknown'

export class AuthError extends Error {
  kind: AuthErrorKind
  constructor(kind: AuthErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'AuthError'
    this.kind = kind
  }
}
