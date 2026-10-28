/** Saves a Blob through the browser's download (a temporary object URL). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // Removing the link or revoking the URL right away can make some browsers drop the file name.
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 30_000)
}

/** Opens the browser's file picker. `folder`: pick a whole folder (webkitdirectory). */
export function pickInput(opts: { accept?: string; multiple?: boolean; folder?: boolean }, onPicked: (files: File[]) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  if (opts.accept) input.accept = opts.accept
  input.multiple = opts.multiple ?? false
  if (opts.folder) input.setAttribute('webkitdirectory', '')
  input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0'
  input.addEventListener('change', () => {
    onPicked(Array.from(input.files ?? []))
    input.remove()
  })
  input.addEventListener('cancel', () => input.remove())
  document.body.appendChild(input)
  input.click()
}

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string }
type FileEntryLike = Entry & { file(ok: (f: File) => void, err: (e: unknown) => void): void }
type DirEntryLike = Entry & { createReader(): { readEntries(ok: (es: Entry[]) => void, err: (e: unknown) => void): void } }

/** Files dropped on the page, folders included (each file keeps its path in the folder). */
export async function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const items = Array.from(data.items ?? []).filter((i) => i.kind === 'file')
  const entries = items.map((i) => (i as DataTransferItem & { webkitGetAsEntry?(): Entry | null }).webkitGetAsEntry?.() ?? null)
  if (!entries.length || entries.some((e) => !e)) return Array.from(data.files ?? [])
  const out: File[] = []
  const walk = async (e: Entry): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((ok, err) => (e as FileEntryLike).file(ok, err))
      const rel = e.fullPath.replace(/^\//, '')
      out.push(rel.includes('/') ? Object.defineProperty(f, 'webkitRelativePath', { value: rel }) : f)
    } else if (e.isDirectory) {
      const reader = (e as DirEntryLike).createReader()
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, err) => reader.readEntries(ok, err))
        if (!batch.length) break
        for (const c of batch) await walk(c)
      }
    }
  }
  for (const e of entries) await walk(e!)
  return out
}
