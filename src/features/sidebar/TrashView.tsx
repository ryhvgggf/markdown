import { useState } from 'react'
import { TRASH_TTL_MS } from '@/core/vault/vault'
import { displayTitle } from '@/core/vault/titles'
import { Button } from '@/ui/components/Button'
import { Folder } from '@/ui/icons'
import type { Ref } from './dnd'
import { trashRoots, type VaultSnapshot } from './use-vault'

export const TRASH_DAY_MS = 24 * 60 * 60 * 1000

export const daysLeft = (deletedAt: number, now: number) =>
  Math.max(1, Math.ceil((deletedAt + TRASH_TTL_MS - now) / TRASH_DAY_MS))

export function TrashView({
  trashed,
  onRestore,
  onPurge,
}: {
  trashed: VaultSnapshot['trashed']
  onRestore(ref: Ref): void
  onPurge(ref: Ref): void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [now] = useState(Date.now)
  const items = trashRoots(trashed)
  if (items.length === 0) return <p className="px-4 py-6 text-center text-[13.5px] text-fg-tertiary">垃圾桶是空的</p>
  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-2">
      {items.map((item) => {
        const ref: Ref = item.kind === 'note' ? { kind: 'note', id: item.note.id } : { kind: 'folder', id: item.folder.id }
        const label = item.kind === 'note' ? displayTitle(item.note.title) : item.folder.name || '未命名資料夾'
        const deletedAt = (item.kind === 'note' ? item.note.deletedAt : item.folder.deletedAt) ?? now
        return (
          <li key={ref.id} className="flex flex-col gap-1 rounded-[8px] px-2 py-1.5 hover:bg-fill">
            <div className="flex items-center gap-1.5 text-[13.5px] text-fg">
              {item.kind === 'folder' && <Folder size={14} className="shrink-0 text-fg-tertiary" />}
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </div>
            <div className="text-xs text-fg-tertiary">{daysLeft(deletedAt, now)} 天後永久刪除</div>
            {confirming === ref.id ? (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="flex-1 text-fg">確定永久刪除？</span>
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
