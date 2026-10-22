import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { bootstrap } from '@/app/bootstrap'
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
    : () => bootstrap({ seedGuide: seedGuide() })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App boot={boot} />
  </StrictMode>,
)
