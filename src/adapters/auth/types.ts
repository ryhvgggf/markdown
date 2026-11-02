/**
 * `adapters/auth` — account sign-up/sign-in, wrapping Supabase Auth (design doc §6). Deliberately thin:
 * this adapter only proves identity (who is this email?); the knowledge-base encryption key never passes
 * through it — see `core/account` and `adapters/crypto`/`adapters/key-store` for that.
 */
export interface AuthUser {
  userId: string
  email: string
}

export interface AuthAdapter {
  /**
   * `needsConfirmation`: "Confirm email" is on, so there is no session until the user follows the link in the
   * email (`redirectTo` is where that link lands).
   */
  signUp(email: string, password: string, opts?: { redirectTo?: string }): Promise<{ userId: string; needsConfirmation: boolean }>
  signIn(email: string, password: string): Promise<{ userId: string }>
  /** Ends this device's session only (other devices stay signed in). */
  signOut(): Promise<void>
  getCurrentUserId(): Promise<string | null>
  getCurrentUser(): Promise<AuthUser | null>
  /** Triggers Supabase's standard "reset password" email flow. */
  requestPasswordReset(email: string, opts?: { redirectTo?: string }): Promise<void>
  /** Sets a new password for the current session (called after the user follows the reset-password link). */
  setPassword(newPassword: string): Promise<void>
  /** Fires when the page was opened from a reset-password link (the session is then that link's). */
  onPasswordRecovery(cb: () => void): () => void
}

export type AuthErrorKind =
  | 'invalid-credentials'
  | 'email-taken'
  | 'email-not-confirmed'
  | 'weak-password'
  | 'rate-limited'
  | 'offline'
  | 'not-authenticated'
  | 'unknown'

export class AuthError extends Error {
  kind: AuthErrorKind
  constructor(kind: AuthErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'AuthError'
    this.kind = kind
  }
}
