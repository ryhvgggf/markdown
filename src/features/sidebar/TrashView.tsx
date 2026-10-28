import { useState } from 'react'
import { useServices } from '@/app/services-context'
import { useLive } from '@/features/panel/use-live'
import { TRASH_TTL_MS } from '@/core/vault/vault'
import { displayTitle } from '@/core/vault/titles'
import { Button } from '@/ui/components/Button'
import { Folder, Paperclip } from '@/ui/icons'
import { trashRoots, type TrashItem, type VaultSnapshot } from './use-vault'

export const TRASH_DAY_MS = 24 * 60 * 60 * 1000

export const daysLeft = (deletedAt: number, now: number) =>
  Math.max(1, Math.ceil((deletedAt + TRASH_TTL_MS - now) / TRASH_DAY_MS))

/** What a trash row stands for: a note, a folder subtree, or an attachment. */
export type TrashRef = { kind: 'note' | 'folder' | 'attachment'; id: string }

function describe(item: TrashItem): { ref: TrashRef; label: string; deletedAt: number | null } {
  if (item.kind === 'note') return { ref: { kind: 'note', id: item.note.id }, label: displayTitle(item.note.title), deletedAt: item.note.deletedAt }
  if (item.kind === 'folder')
    return { ref: { kind: 'folder', id: item.folder.id }, label: item.folder.name || '未命名資料夾', deletedAt: item.folder.deletedAt }
  return { ref: { kind: 'attachment', id: item.attachment.id }, label: item.attachment.filename || '未命名附件', deletedAt: item.attachment.deletedAt }
}

export function TrashView({
  trashed,
  onRestore,
  onPurge,
}: {
  trashed: VaultSnapshot['trashed']
  onRestore(ref: TrashRef): void
  onPurge(ref: TrashRef): void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [now] = useState(Date.now)
  const items = trashRoots(trashed)
  if (items.length === 0) return <p className="px-4 py-6 text-center text-[13.5px] text-fg-tertiary">垃圾桶是空的</p>
  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-2">
      {items.map((item) => {
        const { ref, label, deletedAt } = describe(item)
        return (
          <li key={ref.id} data-kind={ref.kind} className="flex flex-col gap-1 rounded-[8px] px-2 py-1.5 hover:bg-fill">
            <div className="flex items-center gap-1.5 text-[13.5px] text-fg">
              {ref.kind === 'folder' && <Folder size={14} className="shrink-0 text-fg-tertiary" />}
              {ref.kind === 'attachment' && <Paperclip size={14} aria-label="附件" className="shrink-0 text-fg-tertiary" />}
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </div>
            <div className="text-xs text-fg-tertiary">{daysLeft(deletedAt ?? now, now)} 天後永久刪除</div>
            {confirming === ref.id ? (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="flex-1 text-fg">
                  確定永久刪除？{ref.kind === 'attachment' && <AttachmentUseWarning id={ref.id} />}
                </span>
                <Button variant="primary" className="!px-2 !py-0.5 text-xs" onClick={() => (setConfirming(null), onPurge(ref))}>
                  刪除
                </Button>
                <Button className="!px-2 !py-0.5 text-xs" onClick={() => setConfirming(null)}>
                  取消
                </Button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <Button className="!px-2 !py-0.5 text-xs" onClick={() => onRestore(ref)}>
                  還原
                </Button>
                <Button variant="ghost" className="!px-2 !py-0.5 text-xs text-fg-secondary" onClick={() => setConfirming(ref.id)}>
                  永久刪除
                </Button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Before an attachment is deleted for good: how many live notes still show it (they will show a missing file). */
function AttachmentUseWarning({ id }: { id: string }) {
  const { db, vault } = useServices()
  const count = useLive(async () => {
    const rows = await db.attachmentRefs.where('attachmentId').equals(id).toArray()
    return rows.filter((r) => vault.getNote(r.noteId)?.deletedAt === null).length
  }, [db, vault, id])
  if (!count) return null
  return <span className="block text-fg-secondary">仍有 {count} 篇筆記使用，刪除後那裡會顯示「找不到這個檔案」。</span>
}
