import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { bootstrap } from '@/app/bootstrap'
import '@/ui/fonts'
import './index.css'

// Stable reference (App's effect depends on it). In bench mode the test hook is installed after boot;
// `import.meta.env.MODE` is a build-time constant, so production bundles drop this branch entirely.
const boot =
  import.meta.env.MODE === 'bench'
    ? async () => {
        const services = await bootstrap()
        const { installBench } = await import('@/bench/bench-entry')
        installBench(services)
        return services
      }
    : bootstrap

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App boot={boot} />
  </StrictMode>,
)
