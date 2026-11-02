import { describe, expect, it } from 'vitest'
import { toAuthError } from './supabase-auth'

describe('toAuthError', () => {
  it.each([
    [{ message: 'x', status: 400, code: 'email_not_confirmed' }, 'email-not-confirmed'],
    [{ message: 'x', status: 400, code: 'invalid_credentials' }, 'invalid-credentials'],
    [{ message: 'x', status: 422, code: 'weak_password' }, 'weak-password'],
    [{ message: 'x', status: 422, code: 'user_already_exists' }, 'email-taken'],
    [{ message: 'x', status: 429, code: 'over_email_send_rate_limit' }, 'rate-limited'],
    [{ message: 'x', status: 0, name: 'AuthRetryableFetchError' }, 'offline'],
    [{ message: 'x', status: 500, code: 'unexpected_failure' }, 'unknown'],
  ])('%o → %s', (e, kind) => {
    expect(toAuthError(e).kind).toBe(kind)
  })
})
