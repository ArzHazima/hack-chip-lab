// A small subset of Nand2Tetris .tst scripts, enough to drive sequential circuits:
//
//   output-list time%S1.4.1 in%B2.1.2 load%B2.1.2 out%B2.1.2;
//   set in 1, set load 1, tick, output; tock, output;
//   repeat 3 { tick, tock, output; }
//
// Supported: set, eval, tick, tock, ticktock, output, repeat N { ... }, output-list.
// load / output-file / compare-to / echo / clear-echo are accepted and ignored.
// Any other command (while, if ...) is skipped and reported in `Tst.warnings`, not an error.
// Bus indexing (set a[0] 1) IS an error, because skipping it would silently give wrong results.

import { mask } from './chips'
import type { Circuit } from './circuit'
import { CircuitError } from './simulate'
import { Simulator } from './sequential'
import { stripComments } from './text'

export class TstParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TstParseError'
  }
}

export type TstCommand =
  | { op: 'set'; pin: string; value: number }
  | { op: 'eval' | 'tick' | 'tock' | 'ticktock' | 'output' } // ticktock = tick then tock
  | { op: 'output-list'; cols: OutputCol[] } // replaces the columns used by later `output` commands
  | { op: 'repeat'; count: number; body: TstCommand[] }

/** One column of the output-list: `name%B2.1.2` = binary, 2 spaces left, 1 digit, 2 spaces right. */
export interface OutputCol {
  name: string
  fmt: 'B' | 'D' | 'X' | 'S'
  left: number
  len: number
  right: number
}

export interface Tst {
  /** The output-list in effect at the END of the script (the last one declared). Earlier `output`
   *  commands use the list that was active when they ran (see the 'output-list' command). */
  outputList: OutputCol[]
  commands: TstCommand[]
  warnings: string[] // e.g. unknown commands that were ignored
}

/** Deepest allowed `repeat` nesting; also keeps the recursive parser and runner off the stack limit. */
const MAX_NESTING = 100
const IGNORED = new Set(['load', 'output-file', 'compare-to', 'echo', 'clear-echo'])

function tokenize(text: string): string[] {
  const noComments = stripComments(text)
  return noComments.match(/[{},;]|[^\s{},;]+/g) ?? []
}

function parseValue(tok: string): number {
  let m: RegExpMatchArray | null
  if ((m = tok.match(/^%B([01]+)$/i))) return parseInt(m[1], 2)
  if ((m = tok.match(/^%X([0-9a-f]+)$/i))) return parseInt(m[1], 16)
  if ((m = tok.match(/^%D(-?\d+)$/i)) || (m = tok.match(/^(-?\d+)$/))) return parseInt(m[1], 10)
  throw new TstParseError(`Bad value "${tok}" (use 5, %D5, %B101 or %X1F)`)
}

function parseCol(tok: string): OutputCol {
  const m = tok.match(/^([A-Za-z_][\w]*)%([BDXS])(\d+)\.(\d+)\.(\d+)$/)
  if (!m) throw new TstParseError(`Bad output-list column "${tok}" (expected e.g. out%B2.1.2)`)
  return { name: m[1], fmt: m[2] as OutputCol['fmt'], left: +m[3], len: +m[4], right: +m[5] }
}

export function parseTst(text: string): Tst {
  const toks = tokenize(text)
  let pos = 0
  let outputList: OutputCol[] = []
  const warnings: string[] = []

  const skipSeparators = () => {
    while (toks[pos] === ',' || toks[pos] === ';') pos++
  }
  /** Reads tokens up to the next `,` or `;` (the arguments of one command). */
  const args = (): string[] => {
    const out: string[] = []
    while (pos < toks.length && ![',', ';', '}', '{'].includes(toks[pos])) out.push(toks[pos++])
    return out
  }

  /** Skips a command we do not understand: its arguments and, if present, a { ... } block. */
  const skipUnknown = (word: string) => {
    warnings.push(`Unknown command "${word}" was ignored`)
    args()
    if (toks[pos] === '{') {
      let depth = 0
      do {
        if (toks[pos] === '{') depth++
        else if (toks[pos] === '}') depth--
        pos++
      } while (pos < toks.length && depth > 0)
    }
  }

  function block(nested: boolean, depth: number): TstCommand[] {
    const cmds: TstCommand[] = []
    for (;;) {
      skipSeparators()
      if (pos >= toks.length) {
        if (nested) throw new TstParseError('Missing "}" at end of repeat block')
        return cmds
      }
      const word = toks[pos++]
      if (word === '}') {
        if (!nested) throw new TstParseError('Unexpected "}"')
        return cmds
      }
      if (word === '{') throw new TstParseError('Unexpected "{"')
      if (IGNORED.has(word)) {
        args()
      } else if (word === 'output-list') {
        // A new output-list REPLACES the previous one (it does not add columns to it).
        const cols = args().map(parseCol)
        outputList = cols
        cmds.push({ op: 'output-list', cols })
      } else if (word === 'set') {
        const a = args()
        if (a.length !== 2) throw new TstParseError('"set" needs a pin and a value: set in 5')
        if (a[0].includes('[')) throw new TstParseError(`Bus indexing "${a[0]}" is not supported`)
        cmds.push({ op: 'set', pin: a[0], value: parseValue(a[1]) })
      } else if (word === 'eval' || word === 'tick' || word === 'tock' || word === 'ticktock' || word === 'output') {
        cmds.push({ op: word })
      } else if (word === 'repeat') {
        const count = toks[pos]
        if (!/^\d+$/.test(count ?? '')) throw new TstParseError('"repeat" needs a number: repeat 5 { ... }')
        pos++
        if (toks[pos++] !== '{') throw new TstParseError('"repeat N" must be followed by "{"')
        if (depth >= MAX_NESTING) throw new TstParseError(`repeat blocks are nested too deeply (more than ${MAX_NESTING} levels)`)
        cmds.push({ op: 'repeat', count: +count, body: block(true, depth + 1) })
      } else {
        skipUnknown(word)
      }
    }
  }

  const commands = block(false, 0)
  return { outputList, commands, warnings }
}

// ---------------------------------------------------------------------------
// Running a script

/** Pin values at the moment of one `output` command (used to colour wires when a row is clicked). */
export interface Snapshot {
  time: string
  inputs: Record<string, number>
  outputs: Record<string, number>
  wireValues: Record<string, number>
}

export interface TstOutput {
  header: string
  rows: string[] // one line per `output`, like "| 0+  |  0  |  0  |  0  |"
  snapshots: Snapshot[] // parallel to `rows`
  warnings: string[] // values that did not fit and digits that were cut off (each reported once)
}

// Two budgets. Real commands (tick/tock/eval ... run the simulator, ~10 us each) keep the old cap of
// 1,000,000. Loop iterations are cheap, so they get their own cap of 5,000,000 and count even when the body
// is empty: `repeat 99999999999 { }` and nested empty repeats are bounded too. Output rows have a smaller
// cap again (memory: every row keeps a snapshot).
const MAX_COMMANDS = 1_000_000
const MAX_ITERATIONS = 5_000_000
const MAX_ROWS = 100_000

function formatCell(col: OutputCol, value: number | string, width: number): string {
  let s: string
  if (col.fmt === 'S') s = String(value).slice(0, col.len).padEnd(col.len)
  else if (col.fmt === 'B') s = (+value >>> 0).toString(2).padStart(col.len, '0').slice(-col.len)
  else if (col.fmt === 'X') s = (+value >>> 0).toString(16).toUpperCase().padStart(col.len, '0').slice(-col.len)
  else {
    // %D shows a 16-bit value as signed (two's complement). Narrower buses (sel[2], sel[3] ...) are
    // plain unsigned numbers: a 2-bit 2 is "2", not "-2".
    const signed = width >= 16 && +value >= 1 << (width - 1)
    s = String(signed ? +value - (1 << width) : +value).padStart(col.len)
  }
  return ' '.repeat(col.left) + s + ' '.repeat(col.right)
}

/** Runs the script on a fresh Simulator and collects the rows `output` produced. */
export function runTst(circuit: Circuit, tst: Tst): TstOutput {
  const sim = new Simulator(circuit)
  const inPins = circuit.pins.filter((p) => p.kind === 'input')
  const widthOf = new Map(circuit.pins.map((p) => [p.name, p.width]))
  const inputs: Record<string, number> = Object.fromEntries(inPins.map((p) => [p.name, 0]))
  const rows: string[] = []
  const snapshots: Snapshot[] = []
  const warnings = new Set<string>() // a Set, so a warning inside a long repeat is reported once
  let budget = MAX_COMMANDS
  let iterations = MAX_ITERATIONS

  let active: OutputCol[] = [] // the output-list currently in effect
  const row = (): string => {
    const r = sim.eval(inputs)
    const cells = active.map((col) => {
      if (col.name === 'time') return formatCell(col, sim.time, 1)
      const v = col.name in inputs ? inputs[col.name] : r.outputs[col.name]
      if (v === undefined) throw new CircuitError([`.tst output-list names unknown pin "${col.name}"`])
      // %B / %X show exactly `len` digits: a bigger value would silently lose its leading digits.
      if (col.fmt === 'B' || col.fmt === 'X') {
        const needed = (+v >>> 0).toString(col.fmt === 'B' ? 2 : 16).length
        if (needed > col.len) {
          warnings.add(
            `${col.name}%${col.fmt}${col.left}.${col.len}.${col.right}: value ${v} needs ${needed} digits but only ` +
              `${col.len} ${col.len === 1 ? 'is' : 'are'} shown; the leading digits are cut off`,
          )
        }
      }
      return formatCell(col, v, widthOf.get(col.name) ?? 1)
    })
    snapshots.push({ time: sim.time, inputs: { ...inputs }, outputs: r.outputs, wireValues: r.wireValues })
    return `|${cells.join('|')}|`
  }

  const exec = (cmds: TstCommand[]) => {
    for (const cmd of cmds) {
      if (--budget < 0) throw new CircuitError(['.tst script is too long (over 1,000,000 commands)'])
      switch (cmd.op) {
        case 'set':
          if (!inPins.some((p) => p.name === cmd.pin)) {
            throw new CircuitError([`.tst sets "${cmd.pin}", which is not an input pin of the circuit`])
          }
          {
            const w = widthOf.get(cmd.pin) ?? 1
            // Fits = representable in w bits, unsigned (0..2^w-1) or two's complement (-2^(w-1)..-1).
            if (cmd.value >= 2 ** w || cmd.value < -(2 ** (w - 1))) {
              warnings.add(
                `set ${cmd.pin} ${cmd.value}: the value does not fit in ${w} bit${w === 1 ? '' : 's'} ` +
                  `(pin "${cmd.pin}"); it is cut to ${mask(cmd.value, w)}`,
              )
            }
            inputs[cmd.pin] = mask(cmd.value, w) // the table shows what the circuit really received
          }
          break
        case 'eval': sim.eval(inputs); break
        case 'tick': sim.tick(inputs); break
        case 'tock': sim.tock(inputs); break
        case 'ticktock': sim.tick(inputs); sim.tock(inputs); break
        case 'output-list': active = cmd.cols; break
        case 'output':
          if (rows.length >= MAX_ROWS) {
            throw new CircuitError([`.tst script produced too many output rows (more than ${MAX_ROWS.toLocaleString('en-US')})`])
          }
          rows.push(row())
          break
        case 'repeat':
          for (let i = 0; i < cmd.count; i++) {
            if (--iterations < 0) throw new CircuitError(['.tst script is too long (over 5,000,000 loop iterations; empty loops count too)'])
            exec(cmd.body)
          }
          break
      }
    }
  }
  exec(tst.commands)

  const header = `|${tst.outputList
    .map((c) => {
      const w = c.left + c.len + c.right
      const pad = Math.max(0, w - c.name.length)
      return ' '.repeat(pad >> 1) + c.name + ' '.repeat(pad - (pad >> 1))
    })
    .join('|')}|`
  return { header, rows, snapshots, warnings: [...warnings] }
}

// ---------------------------------------------------------------------------
// Comparing with a .cmp file

export interface CmpRowResult {
  index: number
  pass: boolean
  expected: string
  actual: string
}

export interface CmpComparison {
  pass: boolean
  rows: CmpRowResult[]
  message?: string // e.g. different number of rows
}

// Cells are trimmed so spacing never matters; shown as written.
const cells = (line: string): string =>
  line.split('|').slice(1, -1).map((s) => s.trim()).join(' | ')

/** Compares output rows with the data rows of a .cmp (header ignored, spacing ignored). */
export function compareToCmp(actual: string[], cmpText: string): CmpComparison {
  const expected = cmpText.split(/\r?\n/).filter((l) => l.trim() !== '').slice(1)
  const n = Math.max(actual.length, expected.length)
  const rows: CmpRowResult[] = []
  for (let i = 0; i < n; i++) {
    const e = expected[i] === undefined ? '(no row)' : cells(expected[i])
    const a = actual[i] === undefined ? '(no row)' : cells(actual[i])
    // Compared case-insensitively so hex digits (%X) never cause a false mismatch.
    rows.push({ index: i, pass: e.toLowerCase() === a.toLowerCase(), expected: e, actual: a })
  }
  const message =
    actual.length === expected.length ? undefined : `Script produced ${actual.length} rows, .cmp has ${expected.length}`
  return { pass: !message && rows.every((r) => r.pass), rows, message }
}
