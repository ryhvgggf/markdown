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

export function Background() {
  const { storage } = useServices()
  const prefs = usePrefs()
  const loaded = useBlobUrl(storage, prefs.backgroundBlobId ?? '')
  const busyness = useBusyness(storage, prefs.backgroundBlobId)
  const { blur, dim } = effectiveBackground(prefs, busyness)
  const shown = prefs.backgroundBlobId ? loaded.url : null
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
