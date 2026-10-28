import { useServices } from '@/app/services-context'
import { usePrefs } from '@/app/use-prefs'
import { useBlobUrl } from '@/features/editor/media/use-blob-url'

/**
 * The note card's own background image, painted behind its content at a user-set opacity (0 = the card's
 * plain colour shows through completely, 1 = the image is fully visible). Static background-image, no
 * blur/backdrop-filter: it never recomputes on typing or scroll. Independent of the page background, which
 * stays fixed (see Background.tsx) — readability is left to the user's own opacity choice (no auto-busyness
 * adjustment).
 */
export function NoteCardBackground() {
  const { storage } = useServices()
  const { noteBackgroundBlobId, noteBackgroundOpacity } = usePrefs()
  const { url } = useBlobUrl(storage, noteBackgroundBlobId ?? '')
  if (!noteBackgroundBlobId || !url) return null
  return (
    <div
      aria-hidden="true"
      data-testid="note-card-background"
      // Negative z-index: paints above the card's own bg-surface but behind the (non-positioned) scroll
      // content — a positioned sibling with z-index:auto would otherwise paint after non-positioned
      // descendants regardless of DOM order, covering the text.
      className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
      style={{ backgroundImage: `url("${url}")`, opacity: noteBackgroundOpacity }}
    />
  )
}
