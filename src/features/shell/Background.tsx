import { useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'
import { useBlobUrl } from '@/features/editor/media/use-blob-url'
import type { StorageAdapter } from '@/adapters/storage/types'
import { effectiveBackground, measureBlobBusyness } from '@/features/settings/background-busyness'

const busynessCache = new Map<string, number | null>()

function useBusyness(storage: StorageAdapter, id: string | null): number {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!id || busynessCache.has(id)) return
    let cancelled = false
    storage
      .getBlob(id)
      .then((blob) => (blob ? measureBlobBusyness(blob) : null))
      .catch(() => null)
      .then((b) => {
        busynessCache.set(id, b)
        if (!cancelled) bump((n) => n + 1)
      })
    return () => {
      cancelled = true
    }
  }, [storage, id])
  return (id && busynessCache.get(id)) || 0
}

/** The page background as the user set it: image URL (if any), blur 0–1 and white dim 0–1. */
export function useBackground(): { url: string | null; blur: number; dim: number } {
  const { storage } = useServices()
  const prefs = usePrefs()
  const loaded = useBlobUrl(storage, prefs.backgroundBlobId ?? '')
  const busyness = useBusyness(storage, prefs.backgroundBlobId)
  const { blur, dim } = effectiveBackground(prefs, busyness)
  return { url: prefs.backgroundBlobId ? loaded.url : null, blur, dim }
}

/**
 * Glass over the static page background, pre-composited: the same layers as <Background>, pinned to the
 * viewport (background-attachment: fixed) and run through the glass filter. It looks like the live
 * backdrop-filter, but is rasterised once instead of re-filtered by the compositor on every frame (which,
 * without a GPU, cost a missed frame on many keystrokes). Only for a card that sits over the background alone.
 */
export function BakedGlass() {
  const { url, blur, dim } = useBackground()
  const layers = url
    ? `linear-gradient(rgba(255,255,255,${dim}), rgba(255,255,255,${dim})), url("${url}") center / cover no-repeat, var(--page-background)`
    : 'var(--page-background)'
  return (
    <div aria-hidden="true" className="glass-baked">
      <div style={{ background: layers, ['--bg-blur' as string]: `${url ? blur * 40 : 0}px` }} />
    </div>
  )
}

export function Background() {
  const { url: shown, blur, dim } = useBackground()
  return (
    <div aria-hidden="true" data-testid="background" className="absolute inset-0 -z-0 overflow-hidden" style={{ background: 'var(--page-background)' }}>
      {shown && (
        <>
          <div
            className="absolute -inset-10 bg-cover bg-center"
            style={{ backgroundImage: `url("${shown}")`, filter: `blur(${blur * 40}px)` }}
          />
          <div className="absolute inset-0" style={{ background: `rgba(255,255,255,${dim})` }} />
        </>
      )}
    </div>
  )
}
