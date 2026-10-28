export type FileStat = { mtime: number; size: number }

/**
 * A folder the app writes into (the mirror folder, OPFS in tests). Paths are relative, '/'-separated;
 * folders are created on write and removed when a remove leaves them empty.
 */
export interface Dir {
  stat(path: string): Promise<FileStat | null>
  read(path: string): Promise<({ data: Blob } & FileStat) | null>
  write(path: string, data: Blob | string): Promise<FileStat>
  /** No error when missing. */
  remove(path: string): Promise<void>
  /** Every file, recursively. */
  list(): AsyncIterable<{ path: string } & FileStat>
}
