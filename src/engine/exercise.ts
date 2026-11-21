// Exercise chips: a folder of Name.hdl / Name.tst / Name.cmp triples, and running one.

import type { Circuit } from './circuit'
import { compareToCmp, parseTst, runTst, TstParseError, type Snapshot } from './tst'

export type Ext = 'hdl' | 'tst' | 'cmp'
const EXTS: Ext[] = ['hdl', 'tst', 'cmp']

export interface ExerciseFile {
  name: string // file name, e.g. "CompactALU.cmp"
  text: string
}

export interface ExerciseChip {
  name: string // base name shared by the files, e.g. "CompactALU"
  hdl?: ExerciseFile
  tst?: ExerciseFile
  cmp?: ExerciseFile
  missing: Ext[] // which of the three files are absent
}

/** Last path segment (folders may arrive as "dir/sub/Name.hdl" or with backslashes). */
const baseFileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * Groups loose files into chips by base name. Files with other extensions are ignored.
 * If the same file name appears twice (e.g. in two sub-folders) the first one wins.
 * A chip with a missing file is still returned; `missing` says which.
 */
export function groupExerciseFiles(files: ExerciseFile[]): ExerciseChip[] {
  const chips = new Map<string, ExerciseChip>()
  for (const f of files) {
    const fileName = baseFileName(f.name)
    const dot = fileName.lastIndexOf('.')
    if (dot <= 0) continue // no extension, or a hidden file like ".DS_Store"
    const ext = fileName.slice(dot + 1).toLowerCase() as Ext
    if (!EXTS.includes(ext)) continue
    const name = fileName.slice(0, dot)
    const chip = chips.get(name) ?? { name, missing: [] }
    if (!chip[ext]) chip[ext] = { name: fileName, text: f.text }
    chips.set(name, chip)
  }
  const list = [...chips.values()]
  for (const c of list) c.missing = EXTS.filter((e) => !c[e])
  // Alphabetical ignoring case; exact name breaks ties so the order is always the same.
  return list.sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.name < b.name ? -1 : 1),
  )
}

// ---------------------------------------------------------------------------

export interface ExerciseRow {
  index: number
  pass: boolean
  expected: string // the .cmp row (cells joined with " | ")
  actual: string // the row our circuit produced
  snapshot?: Snapshot // pin/wire values, for colouring the board
}

export interface ExerciseRun {
  rows: ExerciseRow[]
  passed: number
  total: number
  columns: string[] // output-list column names
  warnings: string[] // e.g. ignored unknown .tst commands
  message?: string // e.g. row-count mismatch
}

/**
 * Runs a .tst script on the circuit and compares every `output` row with the .cmp.
 * Throws TstParseError (bad script) or CircuitError (bad circuit / unknown pin).
 */
export function runExercise(circuit: Circuit, tstText: string, cmpText: string): ExerciseRun {
  const tst = parseTst(tstText)
  if (tst.outputList.length === 0) throw new TstParseError('The .tst has no output-list, so there is nothing to compare')
  const out = runTst(circuit, tst)
  const cmp = compareToCmp(out.rows, cmpText)
  const rows = cmp.rows.map((r) => ({ ...r, snapshot: out.snapshots[r.index] }))
  return {
    rows,
    passed: rows.filter((r) => r.pass).length,
    total: rows.length,
    columns: tst.outputList.map((c) => c.name),
    warnings: tst.warnings,
    message: cmp.message,
  }
}
