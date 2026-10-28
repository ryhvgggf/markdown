import { useEffect, useMemo, useRef, useState } from 'react'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { INDEX_VERSION, INDEX_VERSION_KEY } from '@/core/maintenance/maintenance'
import { displayTitle } from '@/core/vault/titles'
import type { AttachmentMeta, NoteMeta } from '@/core/vault/types'
import { useBlobUrl } from '@/features/editor/media/use-blob-url'
import { useLive } from '@/features/panel/use-live'
import { Button } from '@/ui/components/Button'
import { ImageIcon, VideoIcon } from '@/ui/icons'

export type AttachmentFilter = 'all' | 'used' | 'unused'

const FILTERS: ReadonlyArray<{ value: AttachmentFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'used', label: '使用中' },
  { value: 'unused', label: '未使用' },
]

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

type Usage = { live: NoteMeta[]; trashed: NoteMeta[] }

/**
 * Every live attachment with where it is used (from the derived attachmentRefs index), filterable by
 * use, each movable to the trash at any time. Usage is shown only once the index is current: right after
 * an upgrade the rebuild is still filling it, and "未使用" would be a guess.
 */
export function AttachmentsView({
  attachments,
  notes,
  onTrash,
}: {
  attachments: AttachmentMeta[]
  /** All notes, trashed included. */
  notes: NoteMeta[]
  onTrash(id: string): void
}) {
  const { db } = useServices()
  const [filter, setFilter] = useState<AttachmentFilter>('all')
  const [confirming, setConfirming] = useState<string | null>(null)
  const refs = useLive(() => db.attachmentRefs.toArray(), [db])
  const indexReady = useLive(async () => (await db.meta.get(INDEX_VERSION_KEY))?.value === INDEX_VERSION, [db])

  const usage = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]))
    const out = new Map<string, Usage>()
    for (const r of refs ?? []) {
      const n = byId.get(r.noteId)
      if (!n) continue
      const u = out.get(r.attachmentId) ?? { live: [], trashed: [] }
      ;(n.deletedAt === null ? u.live : u.trashed).push(n)
      out.set(r.attachmentId, u)
    }
    return out
  }, [refs, notes])

  const known = indexReady === true && refs !== undefined
  const isUsed = (id: string) => (usage.get(id)?.live.length ?? 0) > 0
  const sorted = [...attachments].sort((a, b) => b.createdAt - a.createdAt)
  const shown = !known || filter === 'all' ? sorted : sorted.filter((a) => isUsed(a.id) === (filter === 'used'))
  const total = attachments.reduce((s, a) => s + a.size, 0)
  const usedCount = known ? attachments.filter((a) => isUsed(a.id)).length : 0

  if (attachments.length === 0) {
    return <p className="px-4 py-6 text-center text-[13.5px] text-fg-tertiary">還沒有附件。在筆記裡貼上或拖進圖片、影片就會出現在這裡。</p>
  }

  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <p className="px-2 text-xs text-fg-tertiary">
        共 {attachments.length} 個 · {formatBytes(total)}
      </p>
      {known ? (
        <div role="radiogroup" aria-label="篩選附件" className="mx-2 inline-flex self-start rounded-control bg-fill p-0.5">
          {FILTERS.map((f) => {
            const count = f.value === 'all' ? attachments.length : f.value === 'used' ? usedCount : attachments.length - usedCount
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-[6px] px-2.5 py-0.5 text-xs transition duration-200 ease-spring ${
                  filter === f.value ? 'bg-white font-medium text-fg shadow-sm' : 'text-fg-secondary'
                }`}
              >
                {f.label} {count}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="px-2 text-xs text-fg-tertiary">正在整理附件的使用狀況…</p>
      )}
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-center text-[13px] text-fg-tertiary">{filter === 'used' ? '沒有使用中的附件' : '沒有未使用的附件'}</p>
      ) : (
        <ul aria-label="附件" className="flex flex-col gap-0.5">
          {shown.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              usage={known ? (usage.get(a.id) ?? { live: [], trashed: [] }) : null}
              confirming={confirming === a.id}
              onAskTrash={() => setConfirming(a.id)}
              onCancel={() => setConfirming(null)}
              onTrash={() => {
                setConfirming(null)
                onTrash(a.id)
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function AttachmentRow({
  attachment: a,
  usage,
  confirming,
  onAskTrash,
  onCancel,
  onTrash,
}: {
  attachment: AttachmentMeta
  /** null: not known yet (index still building). */
  usage: Usage | null
  confirming: boolean
  onAskTrash(): void
  onCancel(): void
  onTrash(): void
}) {
  const used = (usage?.live.length ?? 0) > 0
  const open = (id: string) => {
    useUi.getState().openNote(id)
    useUi.getState().setSidebarOverlay(false)
  }
  return (
    <li data-attachment-id={a.id} className="flex gap-2 rounded-[8px] px-2 py-1.5 hover:bg-fill">
      <Thumb attachment={a} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] text-fg" title={a.filename}>
          {a.filename || '未命名附件'}
        </span>
        <span className="text-xs text-fg-tertiary">{formatBytes(a.size)}</span>
        {usage && (
          <div className="flex flex-wrap items-center gap-x-1 text-xs">
            {used ? (
              <>
                <span className="text-fg-secondary">用在</span>
                {usage.live.map((n, i) => (
                  <span key={n.id} className="min-w-0">
                    <button type="button" onClick={() => open(n.id)} className="max-w-[140px] truncate align-bottom text-accent hover:underline">
                      {displayTitle(n.title)}
                    </button>
                    {i < usage.live.length - 1 && <span className="text-fg-tertiary">、</span>}
                  </span>
                ))}
              </>
            ) : (
              <span className="rounded-full bg-fill px-1.5 text-fg-tertiary">
                未使用{usage.trashed.length > 0 ? '（只在垃圾桶中的筆記）' : ''}
              </span>
            )}
          </div>
        )}
        {confirming ? (
          <div className="mt-1 flex flex-col gap-1 text-xs">
            <span className="text-fg">仍有 {usage?.live.length ?? 0} 篇筆記使用這個附件，移到垃圾桶後那裡會顯示「已移到垃圾桶」。</span>
            <div className="flex gap-1.5">
              <Button variant="primary" className="!h-6 !px-2 text-xs" onClick={onTrash}>
                移到垃圾桶
              </Button>
              <Button className="!h-6 !px-2 text-xs" onClick={onCancel}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5">
            <Button
              variant="ghost"
              className="!h-6 !px-1.5 text-xs text-fg-secondary"
              aria-label={`把 ${a.filename || '附件'} 移到垃圾桶`}
              onClick={() => (used ? onAskTrash() : onTrash())}
            >
              移到垃圾桶
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

/** Image thumbnails load only once the row scrolls into view (a vault may hold hundreds). */
function Thumb({ attachment: a }: { attachment: AttachmentMeta }) {
  const { storage } = useServices()
  const box = useRef<HTMLDivElement>(null)
  const isImage = a.mimeType.startsWith('image/')
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (!isImage || visible || !box.current) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    })
    io.observe(box.current)
    return () => io.disconnect()
  }, [isImage, visible])
  const { url } = useBlobUrl(storage, isImage && visible ? a.id : '')
  return (
    <div
      ref={box}
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-fill text-fg-tertiary"
    >
      {isImage && url ? (
        <img src={url} alt="" className="size-full object-cover" draggable={false} />
      ) : isImage ? (
        <ImageIcon size={16} />
      ) : (
        <VideoIcon size={16} />
      )}
    </div>
  )
}
