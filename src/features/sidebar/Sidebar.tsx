import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { filesFromDrop } from '@/features/transfer/download'
import { MirrorPausedChip } from '@/features/transfer/MirrorSection'
import { useServices } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { IconButton } from '@/ui/components/IconButton'
import { ChevronRight, FolderPlus, Plus, Trash } from '@/ui/icons'
import { FolderTree } from './FolderTree'
import { TrashView } from './TrashView'
import { AttachmentsView } from './AttachmentsView'
import { useActions } from './use-actions'
import { useExpanded } from './use-expanded'
import { trashRoots, useVaultSnapshot } from './use-vault'

export function Sidebar() {
  const { vault, storageMode } = useServices()
  const { tree, trashed, attachments, notes } = useVaultSnapshot()
  const allNotes = useMemo(() => [...notes, ...trashed.notes], [notes, trashed.notes])
  const { expanded, loaded, toggle, expand } = useExpanded()
  const actions = useActions(tree, expand)
  const openNoteId = useUi((s) => s.openNoteId)
  const view = useUi((s) => s.sidebarView)
  const setView = useUi((s) => s.setSidebarView)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const trashCount = trashRoots(trashed).length

  // Reveal the open note: expand its ancestors when it changes.
  useEffect(() => {
    if (!loaded || !openNoteId) return
    const ids: string[] = []
    const byId = new Map(vault.listFolders().map((f) => [f.id, f]))
    for (let p = vault.getNote(openNoteId)?.folderId ?? null; p; p = byId.get(p)?.parentId ?? null) ids.push(p)
    expand(ids)
  }, [loaded, openNoteId, vault, expand])

  const [fileOver, setFileOver] = useState(false)
  const hasFiles = (e: { dataTransfer: DataTransfer | null }) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  return (
    <div
      className={`flex h-full min-h-0 flex-col rounded-card ${fileOver ? 'ring-2 ring-accent/60' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setFileOver(false)
        void filesFromDrop(e.dataTransfer).then((files) => files.length && useUi.getState().openImport(files))
      }}
    >
      {view === 'tree' ? (
        <>
          <div className="flex items-center gap-1 px-4 pt-3 pb-2">
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-wide text-fg-secondary">我的知識庫</h2>
            <IconButton label="新增筆記" tooltip onClick={() => actions.createNote()}>
              <Plus size={16} />
            </IconButton>
            <IconButton label="新增資料夾" tooltip onClick={() => setRenamingId(actions.createFolder(null))}>
              <FolderPlus size={16} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loaded && (
              <FolderTree
                tree={tree}
                expanded={expanded}
                actions={actions}
                toggle={toggle}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
              />
            )}
          </div>
        </>
      ) : view === 'trash' ? (
        <SubView title="垃圾桶" onBack={() => setView('tree')}>
          <TrashView trashed={trashed} onRestore={actions.restore} onPurge={(ref) => void actions.purge(ref)} />
        </SubView>
      ) : (
        <SubView title="附件" onBack={() => setView('tree')}>
          <AttachmentsView
            attachments={attachments}
            notes={allNotes}
            onTrash={actions.trashAttachment}
          />
        </SubView>
      )}
      <div className="px-2 pt-1">
        <button
          type="button"
          aria-pressed={view === 'trash'}
          onClick={() => setView(view === 'trash' ? 'tree' : 'trash')}
          className={`flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2 text-[13.5px] hover:bg-fill ${
            view === 'trash' ? 'bg-fill text-fg' : 'text-fg-secondary'
          }`}
        >
          <Trash size={15} />
          <span className="flex-1 text-left">垃圾桶</span>
          {trashCount > 0 && <span className="text-xs text-fg-tertiary">{trashCount}</span>}
        </button>
      </div>
      <p className="flex items-center gap-1.5 px-4 pt-1.5 pb-3 text-xs text-fg-tertiary">
        {storageMode === 'memory' ? (
          <span className="text-amber-600">資料未保存</span>
        ) : (
          <>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-green-500" />
            已儲存在此裝置
            <MirrorPausedChip />
          </>
        )}
      </p>
    </div>
  )
}

function SubView({ title, onBack, children }: { title: string; onBack(): void; children: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-control px-1.5 py-1 text-[13px] text-fg-secondary hover:bg-fill hover:text-fg"
        >
          <ChevronRight size={14} className="rotate-180" />
          返回
        </button>
        <h2 className="flex-1 text-center text-[13px] font-semibold text-fg-secondary">{title}</h2>
        <span className="w-12" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </>
  )
}
