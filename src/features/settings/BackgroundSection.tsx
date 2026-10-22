import { useRef, useState } from 'react'
import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'
import { newId } from '@/core/ids'
import { useBlobUrl } from '@/features/editor/media/use-blob-url'
import { DEFAULT_PREFS } from '@/core/preferences/preferences'
import { Button } from '@/ui/components/Button'
import { SectionLabel, SliderRow } from './controls'

const MAX_BYTES = 20 * 1024 * 1024
const pct = (v: number) => `${Math.round(v * 100)}%`

export function BackgroundSection() {
  const { storage, prefs } = useServices()
  const p = usePrefs()
  const loaded = useBlobUrl(storage, p.backgroundBlobId ?? '')
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File | undefined) {
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) return setError('圖片超過 20 MB，請選擇較小的檔案。')
    if (file.type && !file.type.startsWith('image/')) return setError('請選擇圖片檔案。')
    const previous = prefs.get().backgroundBlobId
    const id = newId()
    try {
      await storage.putBlob(id, file)
      prefs.set({ backgroundBlobId: id })
      if (previous) await storage.deleteBlob(previous)
    } catch {
      setError('無法儲存圖片，請再試一次。')
    }
  }

  async function reset() {
    setError(null)
    const previous = prefs.get().backgroundBlobId
    prefs.set({
      backgroundBlobId: null,
      backgroundBlur: DEFAULT_PREFS.backgroundBlur,
      backgroundDim: DEFAULT_PREFS.backgroundDim,
    })
    if (previous) await storage.deleteBlob(previous).catch(() => undefined)
  }

  return (
    <section aria-label="背景">
      <SectionLabel>背景圖片</SectionLabel>
      <div className="flex items-center gap-4 py-2">
        <div
          data-testid="background-preview"
          className="h-16 w-28 shrink-0 rounded-control bg-cover bg-center shadow-sm"
          style={{ background: p.backgroundBlobId && loaded.url ? `center / cover url("${loaded.url}")` : 'var(--page-background)' }}
        />
        <div className="flex flex-col items-start gap-2">
          <Button onClick={() => input.current?.click()}>
            選擇圖片…
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            aria-label="上傳圖片"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              void upload(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4">
        <SectionLabel>調整</SectionLabel>
        <SliderRow label="模糊度" value={p.backgroundBlur} min={0} max={1} step={0.05} display={pct(p.backgroundBlur)} onChange={(v) => prefs.set({ backgroundBlur: v })} />
        <SliderRow label="淡化程度" value={p.backgroundDim} min={0} max={1} step={0.05} display={pct(p.backgroundDim)} onChange={(v) => prefs.set({ backgroundDim: v })} />
      </div>
      <div className="mt-4">
        <Button variant="ghost" onClick={() => void reset()}>
          恢復預設
        </Button>
      </div>
    </section>
  )
}
