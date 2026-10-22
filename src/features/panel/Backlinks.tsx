import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { useVaultSnapshot } from '@/features/sidebar/use-vault'
import { BacklinkCard } from './BacklinkCard'
import { Mentions } from './Mentions'
import { useBacklinks } from './use-backlinks'
import { useMentions } from './use-mentions'

export function Backlinks({ noteId }: { noteId: string }) {
  const { vault } = useServices()
  useVaultSnapshot()
  const title = vault.getNote(noteId)?.title ?? ''
  const groups = useBacklinks(noteId)
  const openNote = useUi((s) => s.openNote)
  const { mentions, convert } = useMentions(noteId, title, groups.map((g) => g.sourceId))
  const empty = groups.length === 0 && mentions.length === 0

  return (
    <div className="px-3 pb-4">
      {groups.length > 0 && (
        <section aria-labelledby="linked-h">
          <h3 id="linked-h" className="mb-2 text-xs font-semibold text-fg-secondary">
            已連結
          </h3>
          <ul className="flex flex-col gap-2">
            {groups.map((g) => (
              <BacklinkCard
                key={g.sourceId}
                title={g.title}
                folderPath={g.folderPath}
                snippet={g.snippet}
                term={title}
                extra={g.extra}
                onClick={() => openNote(g.sourceId, g.blockId)}
              />
            ))}
          </ul>
        </section>
      )}
      <Mentions title={title} mentions={mentions} onConvert={(id) => void convert(id)} />
      {empty && <p className="mt-6 text-center text-sm text-fg-tertiary">還沒有其他筆記連結到這裡</p>}
    </div>
  )
}
