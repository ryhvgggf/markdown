import { useServices } from '@/app/services-context'
import type { SearchHit } from '@/core/search/search'
import { useVaultSnapshot } from '@/features/sidebar/use-vault'
import { BacklinkCard } from './BacklinkCard'
import { folderPath } from './use-backlinks'

export function Mentions({
  title,
  mentions,
  onConvert,
}: {
  title: string
  mentions: SearchHit[]
  onConvert: (sourceId: string) => void
}) {
  const { vault } = useServices()
  const snap = useVaultSnapshot()
  if (mentions.length === 0) return null
  return (
    <section aria-labelledby="mentions-h" className="mt-5">
      <h3 id="mentions-h" className="mb-2 text-xs font-semibold text-fg-secondary">
        提到但未連結
      </h3>
      <ul className="flex flex-col gap-2">
        {mentions.map((h) => {
          const note = vault.getNote(h.noteId)
          return (
            <BacklinkCard
              key={h.noteId}
              dashed
              title={h.title}
              folderPath={note ? folderPath(snap.folders, note.folderId) : ''}
              snippet={h.snippet}
              term={title}
              action={
                <button
                  type="button"
                  className="mt-2 rounded-full bg-accent/12 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20"
                  onClick={() => onConvert(h.noteId)}
                >
                  轉為連結
                </button>
              }
            />
          )
        })}
      </ul>
    </section>
  )
}
