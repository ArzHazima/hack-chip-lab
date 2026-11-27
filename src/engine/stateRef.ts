// Internal state in .tst scripts: `RAM16K[3]`, `PC[]`, `DRegister[]`, `Screen[i]` ...
//
// Resolved by chip TYPE (docs/ADR-R2-project5.md decision 1), like the official simulator:
//   * depth 0 = an instance of that type on the board (a RAM16K block, a PC block, ...)
//   * depth 1 = a built-in block that has it inside (CPU / Computer expose ARegister, DRegister, PC; Computer and
//     Memory expose RAM16K, Screen, Keyboard words), see `SeqBehavior.exposes` / `exposesWords`.
// The shallowest candidates win. One candidate = used; several = a clear error that lists them.
// (A pin with the same name always wins over a state name; that check is made by the caller, tst.ts.)

import { CHIPS } from './chips'
import type { Circuit } from './circuit'
import { chipOf } from './resolve'
import type { Simulator } from './sequential'
import { CircuitError } from './simulate'

/** One resolved internal state: a single value (size 1) or a memory of `size` words. */
export interface StateTarget {
  type: string
  /** What the user sees in error messages, e.g. `RAM16K block "ram1"` or `the Computer "c1"`. */
  where: string
  size: number // 1 = a single value (`X[]` and `X[0]` both work), otherwise a memory (`X[i]`)
  width: number // bits of one word, for masking and for the signed %D output
  writable: boolean
  get(i: number): number
  set(i: number, value: number): void
}

const isSingle = (t: StateTarget) => t.size === 1

/** Does the circuit have a built-in chip of this TYPE name with state (RAM16K, PC, ...)? */
export const isStateType = (name: string): boolean => CHIPS[name]?.seq !== undefined

/** The text a user wrote: `PC[]`, `RAM16K[3]`. */
export const refLabel = (name: string, index: number | null | undefined): string =>
  index === undefined ? name : index === null ? `${name}[]` : `${name}[${index}]`

/** Words of a directly placed chip: from its `address` pin (RAM8 = 8 ... ROM32K = 32768), else a single value. */
function directSize(type: string): number {
  const addr = CHIPS[type]?.inputs.find((p) => p.name === 'address')
  return addr ? 2 ** addr.width : 1
}

const MISSING_HINT: Record<string, string> = {
  ARegister: 'Build the A register of your CPU with the ARegister block from "Project 3 – Memory" (not a generic Register).',
  DRegister: 'Build the D register of your CPU with the DRegister block from "Project 3 – Memory" (not a generic Register).',
}

/**
 * Finds the instance behind `Type[...]`. Throws CircuitError when there is none or when it is ambiguous.
 * Cheap enough to call once per type and keep the answer (the circuit does not change during a run).
 */
export function resolveState(sim: Simulator, circuit: Circuit, type: string): StateTarget {
  const direct: StateTarget[] = []
  const inner: StateTarget[] = []
  for (const inst of circuit.chips) {
    const def = chipOf(inst)
    const seq = def?.seq
    if (!def || !seq) continue
    if (inst.type === type && seq.peek) {
      const size = directSize(type)
      const width = def.outputs[0]?.width ?? 16
      direct.push({
        type,
        where: `${type} block "${inst.id}"`,
        size,
        width,
        writable: !!seq.poke,
        get: (i) => sim.peek(inst.id, i) ?? 0,
        set: (i, v) => sim.poke(inst.id, i, v),
      })
    }
    const reg = seq.exposes?.[type]
    if (reg !== undefined) {
      inner.push({
        type,
        where: `${type} inside the ${inst.type} "${inst.id}"`,
        size: 1,
        width: reg === 'PC' ? 15 : 16,
        writable: true,
        get: () => sim.peekRegister(inst.id, reg) ?? 0,
        set: (_i, v) => sim.pokeRegister(inst.id, reg, v),
      })
    }
    const words = seq.exposesWords?.[type]
    if (words) {
      inner.push({
        type,
        where: `${type} inside the ${inst.type} "${inst.id}"`,
        size: words.size,
        width: 16,
        writable: true,
        get: (i) => sim.peek(inst.id, words.base + i) ?? 0,
        set: (i, v) => sim.poke(inst.id, words.base + i, v),
      })
    }
  }
  const found = direct.length ? direct : inner
  if (found.length === 0) {
    throw new CircuitError([
      `The .tst refers to the internal state of a ${type}, but this circuit has no ${type}.` +
        (MISSING_HINT[type] ? ` ${MISSING_HINT[type]}` : ''),
    ])
  }
  if (found.length > 1) {
    throw new CircuitError([
      `The .tst refers to ${type}, but the circuit has ${found.length} of them (${found.map((f) => f.where).join('; ')}). ` +
        'Keep one, or delete the others, so the script knows which one is meant.',
    ])
  }
  return found[0]
}

/** Checks `Type[]` / `Type[i]` against what was found (size, bounds). Throws CircuitError with the user's text. */
export function checkIndex(t: StateTarget, index: number | null, label: string): number {
  if (isSingle(t)) {
    if (index === null || index === 0) return 0
    throw new CircuitError([`${label}: a ${t.type} holds one value; write ${t.type}[] (or ${t.type}[0])`])
  }
  if (index === null) throw new CircuitError([`${label}: a ${t.type} has ${t.size} words; write ${t.type}[address]`])
  if (index < 0 || index >= t.size) {
    throw new CircuitError([`${label}: address ${index} is outside this ${t.type} (0..${t.size - 1})`])
  }
  return index
}
