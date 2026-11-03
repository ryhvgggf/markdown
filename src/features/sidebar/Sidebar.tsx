import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { filesFromDrop } from '@/features/transfer/download'
import { MirrorPausedChip } from '@/features/transfer/MirrorSection'
import { useServices } from '@/app/services-context'
import { useAccount, useSyncStatus } from '@/app/use-account'
import type { SyncStatus } from '@/app/sync-status'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { useUi } from '@/app/ui-store'
import { usePrefs } from '@/app/use-prefs'
import { sortTree } from '@/core/vault/tree'
import { IconButton } from '@/ui/components/IconButton'
import { ChevronRight, CloudMinus, FolderPlus, Plus, Trash } from '@/ui/icons'
import { createSelectionModel } from './sync-selection'
import { FolderTree } from './FolderTree'
import { TrashView } from './TrashView'
import { AttachmentsView } from './AttachmentsView'
import { useActions } from './use-actions'
import { useExpanded } from './use-expanded'
import { trashRoots, useVaultSnapshot } from './use-vault'

export function Sidebar() {
  const { vault, storageMode, account } = useServices()
  const signedIn = useAccount(account).status === 'unlocked'
  const syncStatus = useSyncStatus(account)
  const { tree: manualTree, trashed, attachments, notes } = useVaultSnapshot()
  const { sidebarSort, sidebarSortDir } = usePrefs()
  const tree = useMemo(() => sortTree(manualTree, { key: sidebarSort, dir: sidebarSortDir }), [manualTree, sidebarSort, sidebarSortDir])
  const allNotes = useMemo(() => [...notes, ...trashed.notes], [notes, trashed.notes])
  const { expanded, loaded, toggle, expand } = useExpanded()
  const actions = useActions(tree, expand)
  const openNoteId = useUi((s) => s.openNoteId)
  const view = useUi((s) => s.sidebarView)
  const setView = useUi((s) => s.setSidebarView)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const trashCount = trashRoots(trashed).length
  // 同步到雲端 selection: the clicks so far (notes and folders), with the state each should end up in.
  const [picks, setPicks] = useState<Map<string, boolean> | null>(null)
  const [confirmUnsync, setConfirmUnsync] = useState(false)
  const selecting = picks !== null && signedIn && view === 'tree'
  const model = selecting ? createSelectionModel(vault, picks) : null
  const selection = model
    ? {
        state: (id: string) => model.state(id),
        toggle: (id: string) => setPicks((m) => createSelectionModel(vault, m ?? new Map()).toggled(id)),
      }
    : null
  const stopping = model?.counts.stopping ?? 0
  const finish = () => {
    model?.apply()
    setPicks(null)
    setConfirmUnsync(false)
  }

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
          {selecting ? (
            <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5">
              <h2 className="min-w-0 flex-1 truncate pl-1 text-[13px] font-semibold text-fg-secondary">同步到雲端</h2>
              <button
                type="button"
                onClick={() => setPicks(model!.allToggled())}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-accent hover:bg-fill"
              >
                {model!.allOn ? '全不選' : '全選'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-4 pt-3 pb-2">
              <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-wide text-fg-secondary">我的知識庫</h2>
              <IconButton label="新增筆記" tooltip onClick={() => actions.createNote()}>
                <Plus size={16} />
              </IconButton>
              <IconButton label="新增資料夾" tooltip onClick={() => setRenamingId(actions.createFolder(null))}>
                <FolderPlus size={16} />
              </IconButton>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {loaded && (
              <FolderTree
                tree={tree}
                expanded={expanded}
                actions={actions}
                toggle={toggle}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
                syncable={signedIn}
                onSyncSelect={() => setPicks(new Map())}
                selection={selection}
              />
            )}
          </div>
        </>
      ) : view === 'trash' ? (
        <SubView title="垃圾桶" onBack={() => setView('tree')}>
          <TrashView
            trashed={trashed}
            onRestore={actions.restore}
            onPurge={(ref) => void actions.purge(ref)}
            onPurgeAll={(refs) => void actions.purgeAll(refs)}
          />
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
      {selecting && model && (
        <div className="mx-2 mt-1 flex items-center gap-2 rounded-[10px] bg-fill px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-fg-secondary">
            已同步 {model.counts.on}／{model.counts.total} 篇
            {stopping > 0 && <span className="text-amber-600"> · 將停止 {stopping} 篇</span>}
          </p>
          <Button variant="ghost" onClick={() => setPicks(null)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => (stopping > 0 ? setConfirmUnsync(true) : finish())}>
            完成
          </Button>
        </div>
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
            {signedIn && (notes.some((n) => n.synced) || syncStatus.issues.length > 0) && <SyncChip status={syncStatus} />}
          </>
        )}
      </p>
      <Dialog
        title={`停止同步 ${stopping} 篇筆記？`}
        icon={<CloudMinus size={18} />}
        open={selecting && confirmUnsync}
        onOpenChange={setConfirmUnsync}
      >
        <p className="text-sm text-fg-secondary">雲端的副本會被刪除，其他裝置保留目前的內容但不再更新。這台裝置上的筆記不受影響。</p>
        {model && model.stoppingTitles(5).titles.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-fill px-3 py-2 text-[13px] text-fg">
            {model.stoppingTitles(5).titles.map((t, i) => (
              <li key={i} className="truncate">
                {t}
              </li>
            ))}
            {model.stoppingTitles(5).more > 0 && <li className="text-fg-tertiary">還有 {model.stoppingTitles(5).more} 篇</li>}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmUnsync(false)}>
            取消
          </Button>
          <Button variant="danger" onClick={finish}>
            停止同步
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

const SYNC_TEXT: Record<SyncStatus['state'], string> = { off: '', syncing: '同步中…', synced: '已同步', error: '同步有問題' }

/** Cloud sync state after the storage line; opens 設定 · 帳號 for details. */
function SyncChip({ status }: { status: SyncStatus }) {
  if (status.state === 'off') return null
  return (
    <button
      type="button"
      onClick={() => useUi.getState().setSettings(true, 'account')}
      className={`ml-1 rounded px-1 hover:bg-fill ${status.state === 'error' ? 'text-amber-600' : ''}`}
    >
      {SYNC_TEXT[status.state]}
    </button>
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
