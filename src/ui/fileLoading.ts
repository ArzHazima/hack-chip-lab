// Getting files from the browser into the app: folder picker, multi-file picker, drag & drop.

import type { ExerciseFile } from '../engine/exercise'
import { sanitizeCircuit, type SavedCircuit } from './storage'

// .hack = a machine-language program for a ROM32K block (not part of an exercise chip's files).
const WANTED = /\.(hdl|tst|cmp|hack)$/i

/** Limits against a huge or hostile folder: one big file or thousands of files would freeze the tab. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB; real .hdl/.tst/.cmp files are a few KB
export const MAX_FILES = 2_000

export interface ReadResult {
  files: ExerciseFile[]
  warnings: string[] // shown to the user: what was skipped and why
}

/**
 * Reads the text of every .hdl / .tst / .cmp file (other files are skipped, never read).
 * Files over MAX_FILE_BYTES are skipped, and only the first MAX_FILES wanted files are read;
 * both are reported in `warnings`.
 */
export async function readExerciseFiles(files: File[]): Promise<ReadResult> {
  const warnings: string[] = []
  let wanted = files.filter((f) => WANTED.test(f.name))
  if (wanted.length > MAX_FILES) {
    warnings.push(`Too many files: ${wanted.length} .hdl/.tst/.cmp/.hack files were picked; only the first ${MAX_FILES.toLocaleString('en-US')} were loaded.`)
    wanted = wanted.slice(0, MAX_FILES)
  }
  const small = wanted.filter((f) => {
    if (f.size <= MAX_FILE_BYTES) return true
    warnings.push(`Skipped ${f.webkitRelativePath || f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB is over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit per file.`)
    return false
  })
  const read = await Promise.all(small.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })))
  return { files: read, warnings }
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

const wantedCount = (files: File[]): number => files.filter((f) => WANTED.test(f.name)).length

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (wantedCount(out) > MAX_FILES) return // enough: readExerciseFiles reports the excess
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

// --- bundled example chips -------------------------------------------------
// Friends opening the live site have no exercise files, so a few invented chips ship with the app in
// public/examples/ (+ an index.json listing the file names). They are fetched and turned into
// ordinary `File` objects, so they go through readExerciseFiles → groupExerciseFiles exactly like a
// folder the user picked: nothing in the engine knows about them.

/**
 * Downloads the bundled example files. `baseUrl` is Vite's BASE_URL ('/' locally, '/<repo>/' on
 * GitHub Pages), so the URLs also work under a sub-path. `fetchFn` is a parameter so tests can run it
 * without a server.
 */
export async function fetchExampleFiles(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<File[]> {
  const dir = `${baseUrl}examples/`
  const indexRes = await fetchFn(`${dir}index.json`)
  if (!indexRes.ok) throw new Error(`examples/index.json: HTTP ${indexRes.status}`)
  const index = (await indexRes.json()) as { files?: unknown }
  if (!Array.isArray(index.files) || !index.files.every((n) => typeof n === 'string' && /^[\w.-]+$/.test(n))) {
    throw new Error('examples/index.json has an unexpected format')
  }
  return Promise.all(
    (index.files as string[]).map(async (name) => {
      const res = await fetchFn(`${dir}${name}`)
      if (!res.ok) throw new Error(`examples/${name}: HTTP ${res.status}`)
      return new File([await res.text()], name)
    }),
  )
}

// ---- Example solutions ----
// public/examples/solutions/<Chip>.json holds a prebuilt, correct circuit (the same JSON shape as a circuit saved in
// localStorage). index.json lists the chips that have one in "solutions". They are only fetched when the user presses
// "Load solution", and they go through `sanitizeCircuit` like any saved circuit.

/** Names of the example chips that have a bundled solution. A missing / odd index just means "none". */
export async function fetchSolutionNames(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  try {
    const res = await fetchFn(`${baseUrl}examples/index.json`)
    if (!res.ok) return []
    const index = (await res.json()) as { solutions?: unknown }
    if (!Array.isArray(index.solutions)) return []
    return index.solutions.filter((n): n is string => typeof n === 'string' && /^[\w-]+$/.test(n))
  } catch {
    return []
  }
}

/** Downloads one bundled solution as a circuit. Throws a readable error when it cannot be fetched or is not a circuit. */
export async function fetchSolution(baseUrl: string, name: string, fetchFn: typeof fetch = fetch): Promise<SavedCircuit> {
  if (!/^[\w-]+$/.test(name)) throw new Error(`"${name}" is not a valid solution name`)
  const res = await fetchFn(`${baseUrl}examples/solutions/${name}.json`)
  if (!res.ok) throw new Error(`examples/solutions/${name}.json: HTTP ${res.status}`)
  const circuit = sanitizeCircuit(await res.json())
  if (!circuit || circuit.nodes.length === 0) throw new Error(`examples/solutions/${name}.json is not a circuit`)
  return circuit
}
