import { useEffect, useState } from 'react'
import type { StorageAdapter } from '@/adapters/storage/types'

export type BlobUrlState = { url: string | null; status: 'loading' | 'ready' | 'missing' }

const LOADING: BlobUrlState = { url: null, status: 'loading' }

/**
 * Loads an attachment blob and exposes it as an object URL.
 * status: 'loading' (url null) -> 'ready' (url set) or 'missing' (no blob / read failed, url null).
 * The URL is revoked on unmount or when the id changes; nothing is set after cleanup.
 */
export function useBlobUrl(storage: StorageAdapter | undefined, attachmentId: string): BlobUrlState {
  const [state, setState] = useState<{ id: string; value: BlobUrlState }>({ id: attachmentId, value: LOADING })
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    const miss = () => !cancelled && setState({ id: attachmentId, value: { url: null, status: 'missing' } })
    if (!storage || !attachmentId) {
      void Promise.resolve().then(miss)
      return () => {
        cancelled = true
      }
    }
    storage.getBlob(attachmentId).then((blob) => {
      if (cancelled) return
      if (!blob) return miss()
      url = URL.createObjectURL(blob)
      setState({ id: attachmentId, value: { url, status: 'ready' } })
    }, miss)
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [storage, attachmentId])
  return state.id === attachmentId ? state.value : LOADING
}
