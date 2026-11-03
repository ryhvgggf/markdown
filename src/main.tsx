import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { bootstrap, type BootstrapOptions } from '@/app/bootstrap'
import { createE2eShareFacade, isE2eShare, LocalStorageShare } from '@/app/e2e-share'
import '@/ui/fonts'
import './index.css'

/**
 * Automated end-to-end runs (navigator.webdriver is set) may start an empty vault without the built-in
 * guide by setting this localStorage flag (see playwright.config.ts). Ignored in a normal browser.
 */
const NO_GUIDE_FLAG = 'notes-v2:e2e-no-guide'
function seedGuide(): boolean {
  try {
    return !(navigator.webdriver && localStorage.getItem(NO_GUIDE_FLAG) === '1')
  } catch {
    return true
  }
}

/** Automated runs may keep share links in localStorage instead of Supabase (see `app/e2e-share.ts`). */
function shareOverride(): BootstrapOptions['createShare'] {
  try {
    if (!(navigator.webdriver && localStorage.getItem('notes-v2:e2e-share') === '1')) return undefined
  } catch {
    return undefined
  }
  return (db) => createE2eShareFacade(db)
}

// Stable reference (App's effect depends on it). In bench mode the test hook is installed after boot;
// `import.meta.env.MODE` is a build-time constant, so production bundles drop this branch entirely.
const boot =
  import.meta.env.MODE === 'bench'
    ? async () => {
        const services = await bootstrap({ seedGuide: false }) // the bench measures its own seeded vault
        const { installBench } = await import('@/bench/bench-entry')
        installBench(services)
        return services
      }
    : () => bootstrap({ seedGuide: seedGuide(), createShare: shareOverride() })

// A share link (/s/<id>#<key>) opens a read-only page: no local database, no account, no sync.
if (/^\/s\/[^/]+\/?$/.test(location.pathname)) {
  // The link carries the key after `#`; keep the page (and anything it links to) from leaking the address.
  const meta = document.createElement('meta')
  meta.name = 'referrer'
  meta.content = 'no-referrer'
  document.head.append(meta)
  const SharePage = lazy(() => import('@/features/share/SharePage').then((m) => ({ default: m.SharePage })))
  const adapter = async () => {
    if (isE2eShare()) return new LocalStorageShare()
    const [{ SupabaseShare }, { getSupabaseClient }] = await Promise.all([import('@/adapters/share/supabase-share'), import('@/adapters/supabase-client')])
    return new SupabaseShare(getSupabaseClient())
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <SharePage adapter={adapter} />
      </Suspense>
    </StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App boot={boot} />
    </StrictMode>,
  )
}
