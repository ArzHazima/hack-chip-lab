// Getting files from the browser into the app: folder picker, multi-file picker, drag & drop.

import type { ExerciseFile } from '../engine/exercise'

const WANTED = /\.(hdl|tst|cmp)$/i

/** Reads the text of every .hdl / .tst / .cmp file (other files are skipped, never read). */
export async function readExerciseFiles(files: File[]): Promise<ExerciseFile[]> {
  const wanted = files.filter((f) => WANTED.test(f.name))
  return Promise.all(wanted.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })))
}

// --- drag & drop -----------------------------------------------------------
// Dropped FOLDERS are not in `dataTransfer.files`; they must be walked through the
// FileSystemEntry API. The entries have to be grabbed synchronously, before any `await`.

function entryFile(e: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => e.file(resolve, reject))
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    out.push(await entryFile(entry as FileSystemFileEntry))
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns at most ~100 entries per call, so keep calling until it is empty.
    for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
      for (const child of batch) await walk(child, out)
    }
  }
}

export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((e): e is FileSystemEntry => e !== null)
  if (entries.length === 0) return Array.from(dt.files) // browsers without the entry API
  const out: File[] = []
  for (const e of entries) await walk(e, out)
  return out
}

export const hasFiles = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types).includes('Files')
