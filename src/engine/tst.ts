// A subset of Nand2Tetris .tst scripts, enough to drive combinational and sequential circuits:
//
//   output-list time%S1.4.1 in%B2.1.2 load%B2.1.2 out%B2.1.2 RAM16K[3]%D1.6.1 PC[]%D0.4.0;
//   set in 1, set load 1, tick, output; tock, output;
//   repeat 3 { tick, tock, output; }
//   while out <> 75 { tick, tock, }          (also = < > <= >=; capped, see MAX_WHILE)
//   ROM32K load Add.hack,  set RAM16K[3] 5,  set PC[] 0       (internal state, resolved by chip TYPE: stateRef.ts)
//   echo "text"                               (shown as an info line in the results)
//
// Supported: set, eval, tick, tock, ticktock, output, repeat N { }, while cond { }, output-list, echo, clear-echo,
// `ROM32K load File.hack`. `load X.hdl`, output-file and compare-to are accepted and IGNORED; each gives one grey info line (`Tst.notices`), not a warning.
// Any other command is skipped and reported in `Tst.warnings`, not an error.
// Bus indexing of a PIN (set a[0] 1) IS an error, because skipping it would silently give wrong results.
// Values: 5, -5, %D5, %B101, %X1F.

import { mask } from './chips'
import type { Circuit } from './circuit'
import { CircuitError } from './simulate'
import { Simulator } from './sequential'
import { checkIndex, isStateType, refLabel, resolveState, type StateTarget } from './stateRef'

export class TstParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TstParseError'
  }
}

/**
 * A name in a script: `index` undefined = a plain pin name, null = `Type[]`, a number = `Type[i]`.
 * Only built-in chip TYPES with state may be indexed (a pin of the same name wins at run time).
 */
export interface Ref {
  name: string
  index?: number | null
}

export type Compare = '=' | '<>' | '<' | '>' | '<=' | '>='

export type TstCommand =
  | { op: 'set'; target: Ref; value: number }
  | { op: 'eval' | 'tick' | 'tock' | 'ticktock' | 'output' | 'clear-echo' } // ticktock = tick then tock
  | { op: 'output-list'; cols: OutputCol[] } // replaces the columns used by later `output` commands
  | { op: 'repeat'; count: number; body: TstCommand[] }
  | { op: 'while'; lhs: Ref; cmp: Compare; value: number; text: string; body: TstCommand[] }
  | { op: 'echo'; text: string }
  | { op: 'rom-load'; file: string } // ROM32K load File.hack

/** One column of the output-list: `name%B2.1.2` = binary, 2 spaces left, 1 digit, 2 spaces right. */
export interface OutputCol {
  name: string
  index?: number | null // see Ref; `RAM16K[3]%D1.6.1` has name RAM16K, index 3
  fmt: 'B' | 'D' | 'X' | 'S'
  left: number
  len: number
  right: number
}

/** The text of a column as written (also its header): `out`, `PC[]`, `RAM16K[3]`. */
export const colLabel = (c: OutputCol): string => refLabel(c.name, c.index)

export interface Tst {
  /** The output-list in effect at the END of the script (the last one declared). Earlier `output` commands
   *  use the list that was active when they ran (see the 'output-list' command). */
  outputList: OutputCol[]
  commands: TstCommand[]
  warnings: string[] // e.g. unknown commands that were ignored (at most MAX_LISTED + one "... and N more" line)
  /** Commands that are accepted but do nothing here (`load`, `output-file`, `compare-to`). Not a problem: shown as grey info. */
  notices: string[]
}

/** Deepest allowed `repeat` nesting; also keeps the recursive parser and runner off the stack limit. */
const MAX_NESTING = 100
const COMPARES: readonly string[] = ['=', '<>', '<', '>', '<=', '>=']
// Limits on what a script may ask for (a hostile or broken script must stop quickly, not eat all memory).
const MAX_LISTED = 50 // warnings / info lines shown; the rest is counted in one "... and N more" line
const MAX_COL_WIDTH = 64 // left + len + right of one output-list column
const MAX_COLUMNS = 200 // columns in one output-list
const MAX_OUTPUT_CHARS = 50_000_000 // characters in all output rows together

/**
 * A list of distinct messages that keeps only the first MAX_LISTED and counts the rest. A Set makes the
 * "have I seen this?" test O(1); an array `includes` made 60,000 distinct messages take about a minute.
 */
class Listed {
  private seen = new Set<string>()
  private first: string[] = []
  add(msg: string): void {
    if (this.seen.has(msg)) return
    this.seen.add(msg)
    if (this.first.length < MAX_LISTED) this.first.push(msg)
  }
  /** The kept messages, plus "... and N more" when some were left out. */
  toArray(): string[] {
    const more = this.seen.size - this.first.length
    return more > 0 ? [...this.first, `... and ${more} more`] : [...this.first]
  }
  get last(): string | undefined {
    return this.first[this.first.length - 1]
  }
}

// Commands that are accepted but do nothing here; each one is reported once as a grey info line (never skipped silently).
const IGNORED_NOTICE: Record<string, string> = {
  load: 'the circuit on the board is used, not the .hdl file',
  'output-file': 'results are shown in the table, no file is written',
  'compare-to': "the chip's own .cmp file is used",
}

/**
 * Splits the script into tokens: `{ } , ;`, words, and "quoted text" (one token, so a comma or `//` inside an echo
 * string is harmless). Comments (`// ...` and block comments) are dropped. One linear pass, like stripComments:
 * a block comment opener with no closer is kept as text, and we remember that no closer exists, so many
 * openers cannot make this quadratic.
 */
function tokenize(text: string): string[] {
  const toks: string[] = []
  const n = text.length
  let noCloser = false
  const blockEnd = (i: number): number => {
    if (noCloser || text[i] !== '/' || text[i + 1] !== '*') return -1
    const close = text.indexOf('*/', i + 2)
    if (close < 0) noCloser = true
    return close < 0 ? -1 : close + 2
  }
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    const end = blockEnd(i)
    if (end >= 0) {
      i = end
      continue
    }
    if ('{},;'.includes(ch)) {
      toks.push(ch)
      i++
      continue
    }
    if (ch === '"') {
      // up to the closing quote; an unclosed quote ends at the end of its line
      let j = i + 1
      while (j < n && text[j] !== '"' && text[j] !== '\n') j++
      toks.push(text.slice(i, text[j] === '"' ? j + 1 : j))
      i = text[j] === '"' ? j + 1 : j
      continue
    }
    let j = i
    while (j < n && !/[\s{},;"]/.test(text[j]) && !(text[j] === '/' && (text[j + 1] === '/' || blockEnd(j) >= 0))) j++
    if (j === i) j++ // a lone "/" must not loop forever
    toks.push(text.slice(i, j))
    i = j
  }
  return toks
}

function parseValue(tok: string): number {
  let m: RegExpMatchArray | null
  if ((m = tok.match(/^%B([01]+)$/i))) return parseInt(m[1], 2)
  if ((m = tok.match(/^%X([0-9a-f]+)$/i))) return parseInt(m[1], 16)
  if ((m = tok.match(/^%D(-?\d+)$/i)) || (m = tok.match(/^(-?\d+)$/))) return parseInt(m[1], 10)
  throw new TstParseError(`Bad value "${tok}" (use 5, -5, %D5, %B101 or %X1F)`)
}

/** `name`, `Type[]` or `Type[i]`. A bracket on anything that is not a built-in chip type is bus indexing: an error. */
function parseRef(tok: string): Ref {
  const m = tok.match(/^([A-Za-z_]\w*)(?:\[(\d*)\])?$/)
  if (!tok.includes('[')) {
    if (!m) throw new TstParseError(`Bad name "${tok}"`)
    return { name: m[1] }
  }
  if (!m || !isStateType(m[1])) throw new TstParseError(`Bus indexing "${tok}" is not supported`)
  return { name: m[1], index: m[2] === '' ? null : +m[2] }
}

function parseCol(tok: string): OutputCol {
  const m = tok.match(/^([A-Za-z_]\w*(?:\[\d*\])?)%([BDXS])(\d+)\.(\d+)\.(\d+)$/)
  if (!m) throw new TstParseError(`Bad output-list column "${tok}" (expected e.g. out%B2.1.2)`)
  const ref = parseRef(m[1])
  const total = +m[3] + +m[4] + +m[5]
  if (!(total <= MAX_COL_WIDTH)) {
    throw new TstParseError(`Output-list column "${tok}" is too wide: left + length + right must be at most ${MAX_COL_WIDTH}`)
  }
  return { ...ref, fmt: m[2] as OutputCol['fmt'], left: +m[3], len: +m[4], right: +m[5] }
}

const unquote = (t: string): string => (t.startsWith('"') ? t.replace(/^"/, '').replace(/"$/, '') : t)

export function parseTst(text: string): Tst {
  const toks = tokenize(text)
  let pos = 0
  let outputList: OutputCol[] = []
  const warnings = new Listed()
  const notices = new Listed()
  const warn = (w: string) => warnings.add(w)

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
    warn(`Unknown command "${word}" was ignored`)
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

  const openBlock = (what: string, depth: number): TstCommand[] => {
    if (toks[pos++] !== '{') throw new TstParseError(`"${what}" must be followed by "{"`)
    if (depth >= MAX_NESTING) throw new TstParseError(`repeat / while blocks are nested too deeply (more than ${MAX_NESTING} levels)`)
    return block(true, depth + 1)
  }

  function block(nested: boolean, depth: number): TstCommand[] {
    const cmds: TstCommand[] = []
    for (;;) {
      skipSeparators()
      if (pos >= toks.length) {
        if (nested) throw new TstParseError('Missing "}" at end of repeat / while block')
        return cmds
      }
      const word = toks[pos++]
      if (word === '}') {
        if (!nested) throw new TstParseError('Unexpected "}"')
        return cmds
      }
      if (word === '{') throw new TstParseError('Unexpected "{"')
      if (word in IGNORED_NOTICE) {
        const a = args()
        notices.add(`"${[word, ...a].join(' ')}" was ignored: ${IGNORED_NOTICE[word]}`)
      } else if (word === 'echo') {
        cmds.push({ op: 'echo', text: args().map(unquote).join(' ') })
      } else if (word === 'clear-echo') {
        args()
        cmds.push({ op: 'clear-echo' }) // info lines stay in the results, so there is nothing to clear
      } else if (word === 'ROM32K' && toks[pos] === 'load') {
        pos++
        const file = unquote(args().join(' '))
        if (!file) throw new TstParseError('"ROM32K load" needs a file name: ROM32K load Add.hack')
        cmds.push({ op: 'rom-load', file })
      } else if (word === 'output-list') {
        // A new output-list REPLACES the previous one (it does not add columns to it).
        const a = args()
        if (a.length > MAX_COLUMNS) throw new TstParseError(`An output-list may have at most ${MAX_COLUMNS} columns (this one has ${a.length})`)
        const cols = a.map(parseCol)
        outputList = cols
        cmds.push({ op: 'output-list', cols })
      } else if (word === 'set') {
        const a = args()
        if (a.length !== 2) throw new TstParseError('"set" needs a pin and a value: set in 5')
        cmds.push({ op: 'set', target: parseRef(a[0]), value: parseValue(a[1]) })
      } else if (word === 'eval' || word === 'tick' || word === 'tock' || word === 'ticktock' || word === 'output') {
        cmds.push({ op: word })
      } else if (word === 'repeat') {
        const count = toks[pos]
        if (!/^\d+$/.test(count ?? '')) throw new TstParseError('"repeat" needs a number: repeat 5 { ... }')
        pos++
        cmds.push({ op: 'repeat', count: +count, body: openBlock('repeat N', depth) })
      } else if (word === 'while') {
        let a = args()
        if (a.length === 1) {
          const m = a[0].match(/^(.+?)(<>|<=|>=|=|<|>)(.+)$/) // "out<>75" written without spaces
          if (m) a = [m[1], m[2], m[3]]
        }
        if (a.length !== 3 || !COMPARES.includes(a[1])) {
          throw new TstParseError('"while" needs a condition: while out <> 75 { ... } (= <> < > <= >=)')
        }
        cmds.push({
          op: 'while',
          lhs: parseRef(a[0]),
          cmp: a[1] as Compare,
          value: parseValue(a[2]),
          text: a.join(' '),
          body: openBlock('while', depth),
        })
      } else {
        skipUnknown(word)
      }
    }
  }

  const commands = block(false, 0)
  return { outputList, commands, warnings: warnings.toArray(), notices: notices.toArray() }
}

// ---------------------------------------------------------------------------
// Running a script

/** Pin and wire values at one `output` row: rebuilt on demand by a replay (see RunOptions.captureRow). */
export interface Snapshot {
  time: string
  inputs: Record<string, number>
  outputs: Record<string, number>
  wireValues: Record<string, number>
}

export interface TstOutput {
  header: string
  rows: string[] // one line per `output`, like "| 0+  |  0  |  0  |  0  |"
  warnings: string[] // values that did not fit and digits that were cut off (each once; capped like Tst.warnings)
  info: string[] // the text of `echo` commands, in order, each once (capped like Tst.warnings)
  /** Set when the script was stopped (a `while` that never ended, a limit, or a run-time error). The rows produced so far are kept. */
  stopped?: string
  /** Only with RunOptions.captureRow: the snapshot of that row. */
  captured?: Snapshot
}

export interface RunOptions {
  /** Loaded .hack programs by file name, for `ROM32K load X.hack`. */
  programs?: ReadonlyMap<string, ArrayLike<number>>
  /**
   * Replay mode: run only up to the `output` row with this 0-based index and return its Snapshot (inputs, outputs,
   * every wire value) in `captured`. A normal run keeps no wire values at all: 100,000 rows x 300 wires is
   * ~30 million numbers. Clicking a row in the results table replays the (deterministic) script up to that row.
   */
  captureRow?: number
}

// Budgets. Real commands (tick/tock/eval ... run the simulator, ~10 us each) keep the old cap of 1,000,000. Loop
// iterations are cheap, so they get their own cap of 5,000,000 and count even when the body is empty:
// `repeat 99999999999 { }` and nested empty repeats are bounded too. `while` loops have a smaller cap again,
// shared by the whole script: a while that waits for something that never comes (a key press) must end soon
// with a message, not after minutes. Output rows have their own cap (memory).
const MAX_COMMANDS = 1_000_000
const MAX_ITERATIONS = 5_000_000
const MAX_WHILE = 100_000
const MAX_ROWS = 100_000

/** Thrown to leave a run on purpose (never shown to the user as an error). */
class StopRun extends Error {}
const CAPTURED = new StopRun('captured')

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

/** Finds `Add.hack` among the loaded programs: exact name first, then ignoring case and folders. */
function findProgram(programs: RunOptions['programs'], file: string): ArrayLike<number> | undefined {
  if (!programs) return undefined
  const base = file.split(/[\\/]/).pop() ?? file
  const exact = programs.get(base)
  if (exact) return exact
  for (const [name, words] of programs) if (name.toLowerCase() === base.toLowerCase()) return words
  return undefined
}

/** Runs the script on a fresh Simulator and collects the rows `output` produced. */
export function runTst(circuit: Circuit, tst: Tst, opts: RunOptions = {}): TstOutput {
  const sim = new Simulator(circuit)
  const inPins = circuit.pins.filter((p) => p.kind === 'input')
  const widthOf = new Map(circuit.pins.map((p) => [p.name, p.width]))
  const inputs: Record<string, number> = Object.fromEntries(inPins.map((p) => [p.name, 0]))
  const rows: string[] = []
  const info = new Listed()
  const warnings = new Listed() // distinct messages only, so a warning inside a long repeat is reported once
  let outChars = 0 // characters in `rows` so far
  let budget = MAX_COMMANDS
  let iterations = MAX_ITERATIONS
  let whileBudget = MAX_WHILE
  let captured: Snapshot | undefined

  // Internal state by chip type (RAM16K, PC ...), found once per type.
  const targets = new Map<string, StateTarget>()
  const target = (type: string): StateTarget => {
    let t = targets.get(type)
    if (!t) targets.set(type, (t = resolveState(sim, circuit, type)))
    return t
  }
  const noBus = (label: string, name: string) =>
    new CircuitError([`.tst uses bus indexing "${label}" on the pin "${name}", which is not supported`])

  /** Current value of a pin or of an internal state, and the bit width it should be shown with. */
  const read = (ref: Ref, res: ReturnType<Simulator['eval']>): { v: number; width: number } => {
    const label = refLabel(ref.name, ref.index)
    if (ref.index === undefined) {
      const v = ref.name in inputs ? inputs[ref.name] : res.outputs[ref.name]
      if (v === undefined) throw new CircuitError([`.tst output-list names unknown pin "${ref.name}"`])
      return { v, width: widthOf.get(ref.name) ?? 1 }
    }
    if (widthOf.has(ref.name)) throw noBus(label, ref.name) // a pin of that name wins over the chip type
    const t = target(ref.name)
    return { v: t.get(checkIndex(t, ref.index, label)), width: t.width }
  }

  /** A value that does not fit in w bits is cut and reported once (like a pin's `set`). */
  const fit = (label: string, value: number, w: number, what: string): number => {
    // Fits = representable in w bits, unsigned (0..2^w-1) or two's complement (-2^(w-1)..-1).
    if (value >= 2 ** w || value < -(2 ** (w - 1))) {
      warnings.add(
        `set ${label} ${value}: the value does not fit in ${w} bit${w === 1 ? '' : 's'} ` +
          `(${what}); it is cut to ${mask(value, w)}`,
      )
    }
    return mask(value, w) // the table shows what the circuit really received
  }

  let active: OutputCol[] = [] // the output-list currently in effect
  const row = (): string => {
    const r = sim.eval(inputs)
    const cells = active.map((col) => {
      if (col.name === 'time' && col.index === undefined) return formatCell(col, sim.time, 1)
      const { v, width } = read(col, r)
      // %B / %X show exactly `len` digits: a bigger value would silently lose its leading digits.
      if (col.fmt === 'B' || col.fmt === 'X') {
        const needed = (+v >>> 0).toString(col.fmt === 'B' ? 2 : 16).length
        if (needed > col.len) {
          warnings.add(
            `${colLabel(col)}%${col.fmt}${col.left}.${col.len}.${col.right}: value ${v} needs ${needed} digits but only ` +
              `${col.len} ${col.len === 1 ? 'is' : 'are'} shown; the leading digits are cut off`,
          )
        }
      }
      return formatCell(col, v, width)
    })
    if (opts.captureRow === rows.length) {
      captured = { time: sim.time, inputs: { ...inputs }, outputs: r.outputs, wireValues: r.wireValues }
      throw CAPTURED
    }
    return `|${cells.join('|')}|`
  }

  const holds = (cmd: Extract<TstCommand, { op: 'while' }>): boolean => {
    const { v, width } = read(cmd.lhs, sim.eval(inputs))
    const lit = mask(cmd.value, width)
    // Ordering uses the signed value of a 16-bit word (like %D); = and <> compare the bits.
    const sg = (x: number) => (width >= 16 && x >= 1 << (width - 1) ? x - (1 << width) : x)
    switch (cmd.cmp) {
      case '=':
        return v === lit
      case '<>':
        return v !== lit
      case '<':
        return sg(v) < sg(lit)
      case '>':
        return sg(v) > sg(lit)
      case '<=':
        return sg(v) <= sg(lit)
      default:
        return sg(v) >= sg(lit)
    }
  }

  const exec = (cmds: TstCommand[]) => {
    for (const cmd of cmds) {
      if (--budget < 0) throw new CircuitError(['.tst script is too long (over 1,000,000 commands)'])
      switch (cmd.op) {
        case 'set': {
          const { name, index } = cmd.target
          if (index === undefined) {
            if (!inPins.some((p) => p.name === name)) {
              throw new CircuitError([`.tst sets "${name}", which is not an input pin of the circuit`])
            }
            inputs[name] = fit(name, cmd.value, widthOf.get(name) ?? 1, `pin "${name}"`)
          } else {
            const label = refLabel(name, index)
            if (widthOf.has(name)) throw noBus(label, name)
            const t = target(name)
            const i = checkIndex(t, index, label)
            if (!t.writable) throw new CircuitError([`.tst sets ${label}, but a ${t.type} cannot be written (it is read-only)`])
            t.set(i, fit(label, cmd.value, t.width, `one word of a ${t.type}`))
          }
          break
        }
        case 'eval':
          sim.eval(inputs)
          break
        case 'tick':
          sim.tick(inputs)
          break
        case 'tock':
          sim.tock(inputs)
          break
        case 'ticktock':
          sim.tick(inputs)
          sim.tock(inputs)
          break
        case 'output-list':
          active = cmd.cols
          break
        case 'output': {
          if (rows.length >= MAX_ROWS) {
            throw new CircuitError([`.tst script produced too many output rows (more than ${MAX_ROWS.toLocaleString('en-US')})`])
          }
          const text = row()
          if ((outChars += text.length) > MAX_OUTPUT_CHARS) {
            throw new CircuitError([
              `.tst script produced too much output (more than ${(MAX_OUTPUT_CHARS / 1_000_000).toLocaleString('en-US')} million characters)`,
            ])
          }
          rows.push(text)
          break
        }
        case 'echo':
          info.add(cmd.text)
          break
        case 'clear-echo':
          break
        case 'rom-load': {
          const words = findProgram(opts.programs, cmd.file)
          if (!words) {
            throw new CircuitError([
              `The .tst says "ROM32K load ${cmd.file}", but that file is not loaded. Load it with "Load files" or ` +
                '"Load folder" (together with the other exercise files) and run again.',
            ])
          }
          if (sim.loadRom(words) === 0) {
            throw new CircuitError([`The .tst says "ROM32K load ${cmd.file}", but the circuit has no ROM32K and no Computer block.`])
          }
          break
        }
        case 'repeat':
          for (let i = 0; i < cmd.count; i++) {
            if (--iterations < 0) throw new CircuitError(['.tst script is too long (over 5,000,000 loop iterations; empty loops count too)'])
            exec(cmd.body)
          }
          break
        case 'while':
          while (holds(cmd)) {
            if (--whileBudget < 0) {
              const last = info.last !== undefined ? ` The script's last message was: "${info.last}".` : ''
              throw new StopRun(
                `The script was stopped: "while ${cmd.text}" was still true after ${MAX_WHILE.toLocaleString('en-US')} loops.${last} ` +
                  'If this step waits for a key (the official Memory.tst does), type the key code it waits for ' +
                  '(for example 75 for K) in the key box of the Keyboard block on the board before you press Run. ' +
                  'The rows produced before this step are kept.',
              )
            }
            if (--iterations < 0) throw new CircuitError(['.tst script is too long (over 5,000,000 loop iterations; empty loops count too)'])
            exec(cmd.body)
          }
          break
      }
    }
  }
  let stopped: string | undefined
  try {
    exec(tst.commands)
  } catch (e) {
    if (e === CAPTURED) {
      // replay finished: the snapshot is the whole result
    } else if (e instanceof StopRun) stopped = e.message
    else if (e instanceof CircuitError && rows.length > 0) {
      // A run-time error in the MIDDLE of a script (unknown pin, Type[i] out of range, script too long ...): keep the
      // rows produced so far and say why it stopped. With no row yet there is nothing to keep, so the error is thrown
      // as before and the board shows it like any other circuit problem.
      stopped = `The script was stopped: ${e.errors.join(' ')} The rows produced before this step are kept.`
    } else throw e
  }

  const header = `|${tst.outputList
    .map((c) => {
      const w = c.left + c.len + c.right
      const label = colLabel(c)
      const pad = Math.max(0, w - label.length)
      return ' '.repeat(pad >> 1) + label + ' '.repeat(pad - (pad >> 1))
    })
    .join('|')}|`
  return { header, rows, warnings: warnings.toArray(), info: info.toArray(), stopped, captured }
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

/** The cells of one table line, trimmed, so spacing never matters. Column NAMES are never used: columns match by position. */
const cellsOf = (line: string): string[] => line.split('|').slice(1, -1).map((s) => s.trim())

/**
 * Compares output rows with the data rows of a .cmp (header ignored, spacing ignored).
 * Cell by cell, case-insensitively (hex digits), by POSITION: a header may be cut to the column width
 * ("addre", "DRegiste"), so names are never compared. An expected cell of only stars (`*******`) accepts any value.
 */
export function compareToCmp(actual: string[], cmpText: string): CmpComparison {
  const expected = cmpText.split(/\r?\n/).filter((l) => l.trim() !== '').slice(1)
  const n = Math.max(actual.length, expected.length)
  const rows: CmpRowResult[] = []
  for (let i = 0; i < n; i++) {
    const e = expected[i] === undefined ? undefined : cellsOf(expected[i])
    const a = actual[i] === undefined ? undefined : cellsOf(actual[i])
    const pass =
      !!e && !!a && e.length === a.length && e.every((cell, k) => /^\*+$/.test(cell) || cell.toLowerCase() === a[k].toLowerCase())
    rows.push({ index: i, pass, expected: e ? e.join(' | ') : '(no row)', actual: a ? a.join(' | ') : '(no row)' })
  }
  const message =
    actual.length === expected.length ? undefined : `Script produced ${actual.length} rows, .cmp has ${expected.length}`
  return { pass: !message && rows.every((r) => r.pass), rows, message }
}
