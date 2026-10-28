import { strToU8, Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { normalizeZipPath } from '@/core/markdown/paths'
import type { FileEntry } from '@/core/markdown/types'

const SLICE = 256 * 1024
const TEXT = /\.(md|markdown|txt|json)$/i
/** Already-compressed formats are stored, not deflated again. */
const STORED = /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov|m4a|mp3|zip|gz|pdf|docx|xlsx|pptx)$/i

/** A Blob's bytes in chunks (stream() where available; jsdom has only arrayBuffer()). */
async function* chunksOf(b: Blob): AsyncGenerator<Uint8Array> {
  if (typeof b.stream !== 'function') {
    yield new Uint8Array(await b.arrayBuffer())
    return
  }
  const reader = b.stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    yield value
  }
}

/** Streams entries into a ZIP (one file in memory at a time, plus the growing output). */
export async function writeZip(entries: AsyncIterable<FileEntry>): Promise<Blob> {
  const chunks: Uint8Array[] = []
  let fail: Error | null = null
  const zip = new Zip((err, chunk) => {
    if (err) fail = err
    else chunks.push(chunk)
  })
  for await (const e of entries) {
    const f = STORED.test(e.path) ? new ZipPassThrough(e.path) : new ZipDeflate(e.path, { level: 6 })
    f.mtime = e.mtime ?? Date.now()
    zip.add(f)
    if (e.blob) {
      for await (const c of chunksOf(e.blob)) f.push(c)
      f.push(new Uint8Array(0), true)
    } else {
      // Large text (the manifest) is compressed in slices, letting the page breathe in between.
      const bytes = strToU8(e.text ?? '')
      if (bytes.length <= SLICE) f.push(bytes, true)
      else
        for (let i = 0; i < bytes.length; i += SLICE) {
          f.push(bytes.subarray(i, i + SLICE), i + SLICE >= bytes.length)
          await new Promise((r) => setTimeout(r, 0))
        }
    }
    if (fail) throw fail
  }
  zip.end()
  if (fail) throw fail
  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}

/** Reads a ZIP stream: text for .md / .txt / .json, a Blob for anything else. OS junk and directories are skipped; paths stay inside the root. */
export async function readZip(file: Blob): Promise<FileEntry[]> {
  const out: Promise<FileEntry | null>[] = []
  const unzip = new Unzip((f) => {
    const path = normalizeZipPath(f.name)
    if (!path) return
    const parts: Uint8Array[] = []
    out.push(
      new Promise((resolve, reject) => {
        f.ondata = (err, data, final) => {
          if (err) return reject(err)
          parts.push(data)
          if (!final) return
          if (TEXT.test(path)) {
            const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
            let at = 0
            for (const p of parts) {
              all.set(p, at)
              at += p.length
            }
            resolve({ path, text: new TextDecoder().decode(all) })
          } else resolve({ path, blob: new Blob(parts as BlobPart[]) })
        }
        f.start()
      }),
    )
  })
  unzip.register(UnzipInflate)
  for await (const c of chunksOf(file)) unzip.push(c)
  unzip.push(new Uint8Array(0), true)
  return (await Promise.all(out)).filter((e): e is FileEntry => !!e)
}
