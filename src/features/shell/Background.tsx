import { useEffect, useState } from 'react'
import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'

export function Background() {
  const { storage } = useServices()
  const { backgroundBlobId, backgroundBlur, backgroundDim } = usePrefs()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!backgroundBlobId) return
    let cancelled = false
    let created: string | null = null
    storage.getBlob(backgroundBlobId).then((blob) => {
      if (cancelled || !blob) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    }, () => undefined)
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [storage, backgroundBlobId])

  const shown = backgroundBlobId ? url : null
  return (
    <div aria-hidden="true" data-testid="background" className="absolute inset-0 -z-0 overflow-hidden" style={{ background: 'var(--page-background)' }}>
      {shown && (
        <>
          <div
            className="absolute -inset-10 bg-cover bg-center"
            style={{ backgroundImage: `url("${shown}")`, filter: `blur(${backgroundBlur * 40}px)` }}
          />
          <div className="absolute inset-0" style={{ background: `rgba(255,255,255,${backgroundDim})` }} />
        </>
      )}
    </div>
  )
}
