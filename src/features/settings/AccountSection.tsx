import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useServices } from '@/app/services-context'
import type { AccountService, AccountState } from '@/app/account-service'
import { useAccount, useSyncStatus } from '@/app/use-account'
import type { SyncIssueKind } from '@/app/sync-status'
import { displayTitle } from '@/core/vault/titles'
import { Button } from '@/ui/components/Button'
import { SectionLabel } from './controls'

export const MIN_PASSWORD = 8

const ERRORS: Record<string, string> = {
  'invalid-credentials': 'Email 或密碼不正確',
  'email-taken': '這個 Email 已註冊',
  'email-not-confirmed': '請先點驗證信中的連結',
  'weak-password': '密碼太簡單，換一組',
  'rate-limited': '嘗試太多次，請稍後再試',
  offline: '無法連線，請檢查網路',
  'email-send-failed': '寄不出信，請稍後再試；持續發生請檢查寄信設定',
  'wrong-password': '密碼不正確',
  'wrong-recovery-code': '復原碼不正確',
}
const errorText = (e: unknown) => ERRORS[(e as { kind?: string }).kind ?? ''] ?? '發生錯誤，請再試一次'


const inputCls =
  'h-9 w-full rounded-control border border-black/10 bg-white/70 px-3 text-base text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent'

function Field(props: { label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; hint?: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-fg-secondary">
        {props.label}
      </label>
      <input
        id={id}
        type={props.type ?? 'text'}
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className={inputCls}
      />
      {props.hint && <span className="text-xs text-fg-tertiary">{props.hint}</span>}
    </div>
  )
}

/** Runs an account action with a busy flag and an inline error. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      console.warn('[account]', e)
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="flex max-w-sm flex-col gap-3 py-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {children}
    </form>
  )
}

const ErrorLine = ({ text }: { text: string | null }) =>
  text ? (
    <p role="alert" className="text-sm text-red-600">
      {text}
    </p>
  ) : null

const Note = ({ children }: { children: ReactNode }) => <p className="text-sm text-fg-secondary">{children}</p>

export function AccountSection() {
  const { account } = useServices()
  const state = useAccount(account)
  return (
    <section aria-label="帳號">
      <SectionLabel>帳號</SectionLabel>
      <AccountBody account={account} state={state} />
    </section>
  )
}

function AccountBody({ account, state }: { account: AccountService; state: AccountState }) {
  switch (state.status) {
    case 'loading':
      return <Note>載入中…</Note>
    case 'unavailable':
      return <Note>這個版本沒有設定雲端同步，筆記只存在這台裝置。</Note>
    case 'signed-out':
      // a new notice (email sent) starts over on the sign-in form
      return <SignedOut key={state.notice ?? ''} account={account} state={state} />
    case 'locked':
      return <Locked account={account} email={state.email} />
    case 'set-password':
      return <SetPassword account={account} />
    case 'recovery-code':
      return <RecoveryCode account={account} code={state.recoveryCode} />
    case 'choose-vault':
      return <ChooseVault account={account} vaults={state.vaults} />
    case 'needs-recovery':
      return <NeedsRecovery account={account} />
    case 'unlocked':
      return <Unlocked account={account} email={state.email} />
  }
}

function SignedOut({ account, state }: { account: AccountService; state: Extract<AccountState, { status: 'signed-out' }> }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'forgot'>('sign-in')
  const [email, setEmail] = useState(state.email ?? '')
  const [password, setPassword] = useState('')
  const { busy, error, run, setError } = useAction()

  const submit = () => {
    const e = email.trim()
    if (!e) return setError('請輸入 Email')
    if (mode === 'forgot') return void run(() => account.requestPasswordReset(e))
    if (mode === 'sign-up' && password.length < MIN_PASSWORD) return setError(`密碼至少 ${MIN_PASSWORD} 個字元`)
    if (!password) return setError('請輸入密碼')
    void run(() => (mode === 'sign-in' ? account.signIn(e, password) : account.signUp(e, password)))
  }
  const switchTo = (m: typeof mode) => {
    setMode(m)
    setError(null)
  }

  return (
    <div>
      {state.notice === 'confirm-email' && (
        <p role="status" className="py-2 text-sm text-fg">
          驗證信已寄到 {state.email}，點信中的連結後回來登入。
        </p>
      )}
      {state.notice === 'reset-sent' && (
        <p role="status" className="py-2 text-sm text-fg">
          如果這個 Email 有帳號，重設密碼的信已寄出。
        </p>
      )}
      {mode !== 'forgot' && <Note>登入後可以選擇要同步的筆記。筆記在上傳前就加密，只有你的裝置能讀取。</Note>}
      <Form onSubmit={submit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        {mode !== 'forgot' && (
          <Field
            label="密碼"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            hint={mode === 'sign-up' ? `至少 ${MIN_PASSWORD} 個字元` : undefined}
          />
        )}
        <ErrorLine text={error} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {mode === 'sign-in' ? '登入' : mode === 'sign-up' ? '建立帳號' : '寄出重設信'}
          </Button>
          {mode === 'sign-in' && (
            <>
              <Button variant="ghost" onClick={() => switchTo('sign-up')}>
                建立帳號
              </Button>
              <Button variant="ghost" onClick={() => switchTo('forgot')}>
                忘記密碼
              </Button>
            </>
          )}
          {mode !== 'sign-in' && (
            <Button variant="ghost" onClick={() => switchTo('sign-in')}>
              返回登入
            </Button>
          )}
        </div>
      </Form>
    </div>
  )
}

function Locked({ account, email }: { account: AccountService; email: string }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()
  return (
    <Form onSubmit={() => void run(() => account.unlock(password))}>
      <Note>已登入 {email}。輸入密碼，讓這台裝置可以讀取雲端筆記。</Note>
      <Field label="密碼" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      <ErrorLine text={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy || !password}>
          解鎖
        </Button>
        <Button variant="ghost" onClick={() => void run(() => account.cancel())}>
          登出
        </Button>
      </div>
    </Form>
  )
}

function SetPassword({ account }: { account: AccountService }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const { busy, error, run, setError } = useAction()
  const submit = () => {
    if (password.length < MIN_PASSWORD) return setError(`密碼至少 ${MIN_PASSWORD} 個字元`)
    if (password !== again) return setError('兩次輸入的密碼不同')
    void run(() => account.setNewPassword(password))
  }
  return (
    <Form onSubmit={submit}>
      <Note>設定新的密碼。</Note>
      <Field label="新密碼" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
      <Field label="再輸入一次" type="password" value={again} onChange={setAgain} autoComplete="new-password" />
      <ErrorLine text={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          儲存
        </Button>
        <Button variant="ghost" onClick={() => void run(() => account.cancel())}>
          取消
        </Button>
      </div>
    </Form>
  )
}

function RecoveryCode({ account, code }: { account: AccountService; code: string }) {
  return <RecoveryCodeView code={code} onConfirm={() => account.confirmRecoveryCode()} onCancel={() => account.cancel()} />
}

function RecoveryCodeView({ code, onConfirm, onCancel }: { code: string; onConfirm: () => Promise<void>; onCancel: () => Promise<void> | void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const { busy, error, run } = useAction()
  const checkId = useId()
  return (
    <div className="flex max-w-md flex-col gap-3 py-2">
      <Note>忘記密碼時，只有這組復原碼能解開你的雲端筆記。它只會出現這一次，請抄下或存進密碼管理工具。</Note>
      <output
        aria-label="復原碼"
        className="rounded-control bg-fill px-3 py-2 text-center font-mono text-base tracking-wider break-all text-fg select-all"
      >
        {code}
      </output>
      <div>
        <Button
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? '已複製' : '複製'}
        </Button>
      </div>
      <label htmlFor={checkId} className="flex items-center gap-2 text-base text-fg">
        <input id={checkId} type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="accent-[var(--accent)]" />
        我已妥善保存復原碼
      </label>
      <ErrorLine text={error} />
      <div className="flex gap-2">
        <Button variant="primary" disabled={!saved || busy} onClick={() => void run(onConfirm)}>
          完成
        </Button>
        <Button variant="ghost" onClick={() => void run(async () => onCancel())}>
          取消
        </Button>
      </div>
    </div>
  )
}

function ChooseVault({ account, vaults }: { account: AccountService; vaults: ReadonlyArray<{ vaultId: string; createdAt: number }> }) {
  const { busy, error, run } = useAction()
  return (
    <div className="flex max-w-sm flex-col gap-2 py-2">
      <Note>這個帳號有多個知識庫，要使用哪一個？</Note>
      {[...vaults].reverse().map((v) => (
        <Button key={v.vaultId} disabled={busy} className="justify-start" onClick={() => void run(() => account.chooseVault(v.vaultId))}>
          建立於 {new Date(v.createdAt).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })}
        </Button>
      ))}
      <ErrorLine text={error} />
      <div>
        <Button variant="ghost" onClick={() => void run(() => account.cancel())}>
          取消
        </Button>
      </div>
    </div>
  )
}

function NeedsRecovery({ account }: { account: AccountService }) {
  const [code, setCode] = useState('')
  const [lost, setLost] = useState(false)
  const { busy, error, run } = useAction()
  if (lost) {
    return (
      <div className="flex max-w-md flex-col gap-3 py-2">
        <p className="text-sm text-fg">沒有復原碼，這個知識庫的雲端資料將永久無法解開。要改用新的知識庫嗎？本機筆記不受影響。</p>
        <ErrorLine text={error} />
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void run(() => account.abandonVault())}>
            建立新知識庫
          </Button>
          <Button variant="ghost" onClick={() => setLost(false)}>
            返回
          </Button>
        </div>
      </div>
    )
  }
  return (
    <Form onSubmit={() => void run(() => account.recover(code))}>
      <Note>密碼已重設，請輸入復原碼解開雲端筆記。</Note>
      <Field label="復原碼" value={code} onChange={setCode} autoComplete="off" />
      <ErrorLine text={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || !code.trim()}>
          解開
        </Button>
        <Button variant="ghost" onClick={() => setLost(true)}>
          復原碼遺失
        </Button>
        <Button variant="ghost" onClick={() => void run(() => account.cancel())}>
          取消
        </Button>
      </div>
    </Form>
  )
}

function Unlocked({ account, email }: { account: AccountService; email: string }) {
  const { busy, error, run } = useAction()
  const [regen, setRegen] = useState(false)
  if (regen) return <RegenerateRecoveryCode account={account} onDone={() => setRegen(false)} />
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-base text-fg">已登入 {email}</p>
      <SyncProblems account={account} />
      <ErrorLine text={error} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void run(() => account.signOut())}>
          登出
        </Button>
        <Button variant="ghost" onClick={() => setRegen(true)}>
          重新產生復原碼
        </Button>
      </div>
    </div>
  )
}

function RegenerateRecoveryCode({ account, onDone }: { account: AccountService; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  if (code) {
    return (
      <RecoveryCodeView
        code={code}
        onConfirm={async () => {
          await account.confirmNewRecoveryCode()
          onDone()
        }}
        onCancel={() => {
          account.cancelNewRecoveryCode()
          onDone()
        }}
      />
    )
  }
  return (
    <Form onSubmit={() => void run(async () => setCode(await account.prepareRecoveryCode(password)))}>
      <Note>輸入密碼產生新的復原碼。按下完成後，舊的復原碼就會失效。</Note>
      <Field label="密碼" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
      <ErrorLine text={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy || !password}>
          產生
        </Button>
        <Button variant="ghost" onClick={onDone}>
          取消
        </Button>
      </div>
    </Form>
  )
}

const ISSUE_TEXT: Record<Exclude<SyncIssueKind, 'offline'>, string> = {
  conflict: '和雲端另一篇筆記衝突，未合併',
  failed: '同步失敗',
}

/** Sync problems reported by the syncing tab (3f-2); offline is one line however many notes it hit. */
function SyncProblems({ account }: { account: AccountService }) {
  const { vault } = useServices()
  const { issues } = useSyncStatus(account)
  if (issues.length === 0) return null
  const name = (docId: string) => {
    const note = vault.getNote(docId)
    return note ? `「${displayTitle(note.title)}」` : '筆記清單'
  }
  const lines = [
    ...(issues.some((i) => i.kind === 'offline') ? ['無法連線，恢復後自動補傳'] : []),
    ...issues.flatMap((i) =>
      i.kind === 'offline' ? [] : [`${name(i.docId)}${ISSUE_TEXT[i.kind]}${i.message ? `（${i.message}）` : ''}`],
    ),
  ]
  return (
    <div className="flex max-w-md flex-col gap-2 rounded-control bg-amber-50 px-3 py-2">
      <ul aria-label="同步問題" className="flex flex-col gap-1 text-sm text-fg">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div>
        <Button variant="ghost" onClick={() => account.dismissSyncIssues()}>
          知道了
        </Button>
      </div>
    </div>
  )
}
