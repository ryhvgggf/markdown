export type AccountErrorKind = 'not-found' | 'wrong-password' | 'wrong-recovery-code' | 'unknown'

export class AccountError extends Error {
  kind: AccountErrorKind
  constructor(kind: AccountErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'AccountError'
    this.kind = kind
  }
}

export interface SignUpResult {
  userId: string
  vaultId: string
  kek: CryptoKey
  /** Show once; the caller is responsible for making the user confirm they've written it down. */
  recoveryCode: string
}

export interface SignInResult {
  userId: string
  vaults: Array<{ vaultId: string; createdAt: number }>
}

export interface NewVaultResult {
  vaultId: string
  kek: CryptoKey
  recoveryCode: string
}
