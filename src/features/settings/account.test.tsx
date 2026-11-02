import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryAuth } from '@/adapters/auth/memory-auth'
import { MemoryKeyStore } from '@/adapters/key-store/memory-key-store'
import { createAccountService, type AccountService } from '@/app/account-service'
import { bootstrap } from '@/app/bootstrap'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { SettingsDialog } from './SettingsDialog'

let n = 0
const opened: AccountService[] = []
afterEach(() => {
  opened.splice(0).forEach((a) => a.close())
  act(() => useUi.setState({ settingsOpen: false }))
})

async function setup() {
  const auth = new MemoryAuth({ requireConfirmation: true })
  const keyStore = new MemoryKeyStore()
  const services = await bootstrap({
    dbName: `account-ui-${n++}`,
    forceMemory: true,
    seedGuide: false,
    createAccount: ({ db, vault }) => {
      const a = createAccountService({
        auth,
        keyStore,
        vault,
        meta: {
          get: async (k) => (await db.meta.get(k))?.value,
          put: async (k, v) => void (await db.meta.put({ key: k, value: v })),
          delete: (k) => db.meta.delete(k),
        },
      })
      opened.push(a)
      return a
    },
  })
  await services.account.init()
  render(
    <ServicesProvider services={services}>
      <SettingsDialog />
    </ServicesProvider>,
  )
  const user = userEvent.setup()
  act(() => useUi.getState().setSettings(true, 'account'))
  const dialog = await screen.findByRole('dialog', { name: '設定' })
  await within(dialog).findByRole('region', { name: '帳號' })
  return { auth, keyStore, services, user, dialog }
}

describe('設定 · 帳號', () => {
  it('sign up → check email → sign in → recovery code → signed in → sign out', async () => {
    const { auth, user, dialog } = await setup()
    const d = within(dialog)
    await user.click(d.getByRole('button', { name: '建立帳號' }))
    await user.type(d.getByLabelText('Email'), 'a@example.com')
    await user.type(d.getByLabelText('密碼'), 'short')
    await user.click(d.getByRole('button', { name: '建立帳號' }))
    expect(d.getByRole('alert')).toHaveTextContent('密碼至少 8 個字元')

    await user.clear(d.getByLabelText('密碼'))
    await user.type(d.getByLabelText('密碼'), 'hunter2hunter2')
    await user.click(d.getByRole('button', { name: '建立帳號' }))
    expect(await d.findByRole('status')).toHaveTextContent('驗證信已寄到 a@example.com')

    // signing in before confirming
    await user.type(d.getByLabelText('密碼'), 'hunter2hunter2')
    await user.click(d.getByRole('button', { name: '登入' }))
    expect(await d.findByRole('alert')).toHaveTextContent('請先點驗證信中的連結')

    auth.confirmEmail('a@example.com')
    await auth.signOut()
    await user.click(d.getByRole('button', { name: '登入' }))
    const code = await d.findByRole('status', { name: '復原碼' })
    expect(code.textContent).toMatch(/^([A-Z0-9]{4}-){7}[A-Z0-9]{4}$/)
    const done = d.getByRole('button', { name: '完成' })
    expect(done).toBeDisabled()
    await user.click(d.getByLabelText('我已妥善保存復原碼'))
    await user.click(done)
    expect(await d.findByText('已登入 a@example.com')).toBeInTheDocument()

    await user.click(d.getByRole('button', { name: '登出' }))
    expect(await d.findByRole('button', { name: '登入' })).toBeInTheDocument()
    expect(d.getByLabelText('Email')).toHaveValue('a@example.com')
  })

  it('wrong password shows an error; 忘記密碼 sends the reset email', async () => {
    const { auth, user, dialog } = await setup()
    await auth.signUp('a@example.com', 'hunter2hunter2')
    auth.confirmEmail('a@example.com')
    await auth.signOut()
    const d = within(dialog)
    await user.type(d.getByLabelText('Email'), 'a@example.com')
    await user.type(d.getByLabelText('密碼'), 'nope-nope')
    await user.click(d.getByRole('button', { name: '登入' }))
    expect(await d.findByRole('alert')).toHaveTextContent('Email 或密碼不正確')

    await user.click(d.getByRole('button', { name: '忘記密碼' }))
    expect(d.queryByLabelText('密碼')).toBeNull()
    await user.click(d.getByRole('button', { name: '寄出重設信' }))
    expect(await d.findByRole('status')).toHaveTextContent('重設密碼的信已寄出')
    expect(auth.resetRequested.has('a@example.com')).toBe(true)
  })

  it('a reset link opens 設定新密碼, then asks for the recovery code', async () => {
    const { auth, services, user, dialog } = await setup()
    const d = within(dialog)
    await services.account.signUp('a@example.com', 'hunter2hunter2')
    auth.confirmEmail('a@example.com')
    await auth.signOut()
    await services.account.signIn('a@example.com', 'hunter2hunter2')
    await services.account.confirmRecoveryCode()
    await services.account.signOut()

    act(() => auth.openResetLink('a@example.com'))
    await d.findByText('設定新的密碼。')
    await user.type(d.getByLabelText('新密碼'), 'brand-new-pass')
    await user.type(d.getByLabelText('再輸入一次'), 'brand-new-pass')
    await user.click(d.getByRole('button', { name: '儲存' }))
    await d.findByLabelText('復原碼')
    await user.type(d.getByLabelText('復原碼'), 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX')
    await user.click(d.getByRole('button', { name: '解開' }))
    expect(await d.findByRole('alert')).toHaveTextContent('復原碼不正確')

    await user.click(d.getByRole('button', { name: '復原碼遺失' }))
    await user.click(d.getByRole('button', { name: '建立新知識庫' }))
    await waitFor(() => expect(d.getByRole('status', { name: '復原碼' })).toBeInTheDocument())
  })
})
