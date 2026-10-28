import { useRef, useState } from 'react'
import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'
import { newId } from '@/core/ids'
import { useBlobUrl } from '@/features/editor/media/use-blob-url'
import { isSvg, SVG_REJECTED } from '@/features/editor/media/add-media'
import { DEFAULT_PREFS } from '@/core/preferences/preferences'
import { Button } from '@/ui/components/Button'
import { SectionLabel, SliderRow } from './controls'

const MAX_BYTES = 20 * 1024 * 1024
const pct = (v: number) => `${Math.round(v * 100)}%`

export function BackgroundSection() {
  const { storage, prefs } = useServices()
  const p = usePrefs()
  const loaded = useBlobUrl(storage, p.noteBackgroundBlobId ?? '')
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File | undefined) {
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) return setError('圖片超過 20 MB，請選擇較小的檔案。')
    if (file.type && !file.type.startsWith('image/')) return setError('請選擇圖片檔案。')
    if (isSvg(file.type, file.name)) return setError(SVG_REJECTED)
    const id = newId()
    try {
      await storage.putBlob(id, file)
      // Read the previous id only now (synchronously with the swap): with two uploads in flight, each
      // replaces whatever is current, so the loser's blob is always deleted (M7).
      const previous = prefs.get().noteBackgroundBlobId
      prefs.set({ noteBackgroundBlobId: id })
      if (previous) await storage.deleteBlob(previous)
    } catch {
      setError('無法儲存圖片，請再試一次。')
    }
  }

  async function reset() {
    setError(null)
    const previous = prefs.get().noteBackgroundBlobId
    prefs.set({
      noteBackgroundBlobId: null,
      noteBackgroundOpacity: DEFAULT_PREFS.noteBackgroundOpacity,
    })
    if (previous) await storage.deleteBlob(previous).catch(() => undefined)
  }

  return (
    <section aria-label="背景">
      <SectionLabel>筆記卡片背景</SectionLabel>
      <div className="flex items-center gap-4 py-2">
        <div
          data-testid="note-background-preview"
          className="h-16 w-28 shrink-0 rounded-control bg-cover bg-center shadow-sm"
          style={{ background: p.noteBackgroundBlobId && loaded.url ? `center / cover url("${loaded.url}")` : 'var(--page-background)' }}
        />
        <div className="flex flex-col items-start gap-2">
          <Button onClick={() => input.current?.click()}>上傳圖片</Button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            aria-label="背景圖片檔案"
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
        <SliderRow
          label="透明度"
          value={p.noteBackgroundOpacity}
          min={0}
          max={1}
          step={0.05}
          display={pct(p.noteBackgroundOpacity)}
          onChange={(v) => prefs.set({ noteBackgroundOpacity: v })}
        />
      </div>
      <div className="mt-4">
        <Button variant="ghost" onClick={() => void reset()}>
          恢復預設
        </Button>
      </div>
    </section>
  )
}
