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
    <section aria-labelledby="mentions-h">
      <h3 id="mentions-h" className="panel-section">
        提到但未連結 · {mentions.length}
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
                  className="panel-chip mt-2"
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
