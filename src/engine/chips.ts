// Built-in chip definitions. Each chip is a "black box": named input/output pins
// with bit widths, plus a pure `eval` function mapping input values to output values.
// Signals are plain numbers; a 16-bit bus is a number in 0..65535.

import type { ChipInstance } from './circuit'
import { PROJECT5_CHIPS } from './projectFive'

export interface PinDef {
  name: string
  width: number
}

/**
 * Behaviour of a clocked (stateful) chip. Each chip INSTANCE owns one state object
 * (created by `init`), so two DFFs on the board never share a value.
 *
 * Clock model (same as Nand2Tetris):
 *   tick: inputs are sampled and remembered ("latched"), outputs do not change yet;
 *   tock: the latched values become the stored state, so outputs change now.
 */
export interface SeqBehavior {
  /**
   * Which INPUT pins change an output right now (combinationally). Every other input is only sampled at
   * the clock tick, so a wire into it creates no dependency and a feedback loop through it is legal
   * (this is how the Nand2Tetris hardware simulator treats these chips):
   *   DFF, Bit, Register, PC ...  []           out comes from the stored state only
   *   RAM8 .. RAM16K, ROM32K, Screen, Memory   ['address']  out = memory[address]; in and load are sampled at the tick
   *   Keyboard                    []           out is the key that is held
   * This is the shorthand for "every output depends on exactly these inputs"; `deps` refines it per output.
   */
  combInputs: readonly string[]
  /**
   * Optional, per OUTPUT pin: the inputs that output depends on right now. An output missing from the map
   * uses `combInputs`. Needed by chips whose outputs differ (a CPU: `pc` and `addressM` come from registers,
   * `outM` depends on `inM`), so that ROM.out -> CPU -> ROM.address is a normal fetch loop, not a cycle.
   * Rule for `read`: it is called once per group of outputs that share the same dependencies, with ONLY
   * those inputs filled in; it must compute each output from its declared inputs (and state) alone.
   */
  deps?: Readonly<Record<string, readonly string[]>>
  /** Fresh state. `inst` is the circuit instance (ROM32K reads `inst.program`, Keyboard / Memory `inst.key`). */
  init(inst?: ChipInstance): unknown
  /** Current outputs, from the stored state (and, for RAM, the address input). */
  read(inp: Record<string, number>, state: unknown): Record<string, number>
  tick(inp: Record<string, number>, state: unknown): void
  tock(state: unknown): void
  /** A single number to show live on the board (DFF bit, PC counter); undefined = none. */
  stored?(state: unknown): number | undefined
  /**
   * Called by Simulator.reset() instead of throwing the state away. Chips without it are simply recreated
   * (registers go back to 0). RAM / Screen / Memory clear their words but keep their array (allocated once);
   * ROM32K and Keyboard keep the program / the key: Reset clears the machine, not the program.
   */
  reset?(state: unknown): void
  /** ROM32K: replace the program (extra words beyond 32768 are ignored). */
  loadRom?(state: unknown, words: ArrayLike<number>): void
  /** Keyboard / Memory: the key code that is held (0 = none). */
  setKey?(state: unknown, key: number): void
  /** Read one stored word (`index` for memories) or the stored value, for tests and the .tst of later stages. */
  peek?(state: unknown, index?: number): number
  /** Write one stored word directly (no clock). Read-only chips (ROM32K) have none. */
  poke?(state: unknown, index: number, value: number): void
  /** CPU / Computer: read an internal register by name ("A", "D", "PC"). Undefined for an unknown name. */
  peekReg?(state: unknown, name: string): number | undefined
  /** CPU / Computer: write an internal register by name, masked to its width (A, D 16 bits; PC 15 bits). */
  pokeReg?(state: unknown, name: string, value: number): void
  /**
   * Which built-in chip TYPES live inside this block and which register name reaches each one, e.g.
   * { ARegister: 'A', DRegister: 'D', PC: 'PC' } for CPU and Computer. The stage 3 .tst syntax (ARegister[], PC[])
   * resolves by chip type through this table, so a built-in CPU and a CPU built from ARegister + DRegister + PC
   * blocks answer the same names.
   */
  exposes?: Readonly<Record<string, string>>
}

export interface ChipDef {
  name: string
  inputs: PinDef[]
  outputs: PinDef[]
  /** Pure evaluation. For sequential chips this is the output of a freshly reset chip. */
  eval: (inp: Record<string, number>) => Record<string, number>
  seq?: SeqBehavior
}

/**
 * Widest bus / pin supported. Values are plain numbers masked with 32-bit operators
 * (`1 << width`), so a 32-bit mask would silently be 0; every width is capped at 16 instead.
 */
export const MAX_WIDTH = 16

/** Keep only the low `width` bits of v (also fixes negatives from `~`). */
export function mask(v: number, width: number): number {
  return (v & ((1 << width) - 1)) >>> 0
}

const p = (name: string, width = 1): PinDef => ({ name, width })
const W = 16

// Helper for chips with many same-width data pins, e.g. a..h.
const letters = (n: number, width: number): PinDef[] =>
  'abcdefgh'
    .split('')
    .slice(0, n)
    .map((c) => p(c, width))

const defs: ChipDef[] = [
  {
    name: 'Nand',
    inputs: [p('a'), p('b')],
    outputs: [p('out')],
    eval: ({ a, b }) => ({ out: (a & b) ^ 1 }),
  },
  {
    name: 'Not',
    inputs: [p('in')],
    outputs: [p('out')],
    eval: (i) => ({ out: i.in ^ 1 }),
  },
  {
    name: 'And',
    inputs: [p('a'), p('b')],
    outputs: [p('out')],
    eval: ({ a, b }) => ({ out: a & b }),
  },
  {
    name: 'Or',
    inputs: [p('a'), p('b')],
    outputs: [p('out')],
    eval: ({ a, b }) => ({ out: a | b }),
  },
  {
    name: 'Xor',
    inputs: [p('a'), p('b')],
    outputs: [p('out')],
    eval: ({ a, b }) => ({ out: a ^ b }),
  },
  {
    name: 'Mux',
    inputs: [p('a'), p('b'), p('sel')],
    outputs: [p('out')],
    eval: ({ a, b, sel }) => ({ out: sel ? b : a }),
  },
  {
    name: 'DMux',
    inputs: [p('in'), p('sel')],
    outputs: [p('a'), p('b')],
    eval: (i) => ({ a: i.sel ? 0 : i.in, b: i.sel ? i.in : 0 }),
  },
  {
    name: 'Not16',
    inputs: [p('in', W)],
    outputs: [p('out', W)],
    eval: (i) => ({ out: mask(~i.in, W) }),
  },
  {
    name: 'And16',
    inputs: [p('a', W), p('b', W)],
    outputs: [p('out', W)],
    eval: ({ a, b }) => ({ out: a & b }),
  },
  {
    name: 'Or16',
    inputs: [p('a', W), p('b', W)],
    outputs: [p('out', W)],
    eval: ({ a, b }) => ({ out: a | b }),
  },
  {
    name: 'Mux16',
    inputs: [p('a', W), p('b', W), p('sel')],
    outputs: [p('out', W)],
    eval: ({ a, b, sel }) => ({ out: sel ? b : a }),
  },
  {
    name: 'Or8Way',
    inputs: [p('in', 8)],
    outputs: [p('out')],
    eval: (i) => ({ out: i.in !== 0 ? 1 : 0 }),
  },
  {
    name: 'Mux4Way16',
    inputs: [...letters(4, W), p('sel', 2)],
    outputs: [p('out', W)],
    eval: (i) => ({ out: i['abcd'[i.sel]] }),
  },
  {
    name: 'Mux8Way16',
    inputs: [...letters(8, W), p('sel', 3)],
    outputs: [p('out', W)],
    eval: (i) => ({ out: i['abcdefgh'[i.sel]] }),
  },
  {
    name: 'DMux4Way',
    inputs: [p('in'), p('sel', 2)],
    outputs: letters(4, 1),
    eval: (i) => {
      const out: Record<string, number> = {}
      'abcd'.split('').forEach((c, k) => (out[c] = i.sel === k ? i.in : 0))
      return out
    },
  },
  {
    name: 'DMux8Way',
    inputs: [p('in'), p('sel', 3)],
    outputs: letters(8, 1),
    eval: (i) => {
      const out: Record<string, number> = {}
      'abcdefgh'.split('').forEach((c, k) => (out[c] = i.sel === k ? i.in : 0))
      return out
    },
  },
  // ---- Project 2: Boolean Arithmetic ----
  {
    name: 'HalfAdder',
    inputs: [p('a'), p('b')],
    outputs: [p('sum'), p('carry')],
    eval: ({ a, b }) => ({ sum: a ^ b, carry: a & b }),
  },
  {
    name: 'FullAdder',
    inputs: [p('a'), p('b'), p('c')],
    outputs: [p('sum'), p('carry')],
    eval: ({ a, b, c }) => {
      const total = a + b + c // 0..3: bit 0 is the sum, bit 1 is the carry
      return { sum: total & 1, carry: total >> 1 }
    },
  },
  {
    name: 'Add16',
    inputs: [p('a', W), p('b', W)],
    outputs: [p('out', W)],
    eval: ({ a, b }) => ({ out: mask(a + b, W) }), // overflow is ignored (wraps)
  },
  {
    name: 'Inc16',
    inputs: [p('in', W)],
    outputs: [p('out', W)],
    eval: (i) => ({ out: mask(i.in + 1, W) }),
  },
  {
    // The Hack ALU. Control bits are applied in this order:
    //   zx/nx: zero / negate x   zy/ny: zero / negate y
    //   f: 1 → x+y, 0 → x&y      no: negate the output
    name: 'ALU',
    inputs: [p('x', W), p('y', W), p('zx'), p('nx'), p('zy'), p('ny'), p('f'), p('no')],
    outputs: [p('out', W), p('zr'), p('ng')],
    eval: (i) => {
      let x = i.zx ? 0 : i.x
      if (i.nx) x = mask(~x, W)
      let y = i.zy ? 0 : i.y
      if (i.ny) y = mask(~y, W)
      let out = i.f ? mask(x + y, W) : x & y
      if (i.no) out = mask(~out, W)
      return { out, zr: out === 0 ? 1 : 0, ng: (out >> (W - 1)) & 1 }
    },
  },
]

// ---- Project 3: sequential chips ----

function seqChip(
  name: string,
  inputs: PinDef[],
  outputs: PinDef[],
  seq: SeqBehavior,
): ChipDef {
  return { name, inputs, outputs, seq, eval: (inp) => seq.read(inp, seq.init()) }
}

type Reg = { cur: number; next: number }

/** D flip-flop: out(t+1) = in(t). `width` 16 gives DFF16 (16 DFFs side by side). */
function dffChip(name: string, width: number): ChipDef {
  return seqChip(name, [p('in', width)], [p('out', width)], {
    combInputs: [],
    init: (): Reg => ({ cur: 0, next: 0 }),
    read: (_inp, s) => ({ out: (s as Reg).cur }),
    tick: (inp, s) => void ((s as Reg).next = inp.in),
    tock: (s) => void ((s as Reg).cur = (s as Reg).next),
    stored: (s) => (s as Reg).cur,
  })
}

/**
 * Bit / Register / ARegister / DRegister (they all behave the same):
 *   out(t+1) = load(t) ? in(t) : out(t)
 * Its output comes from the stored value only (no combinational inputs), so a feedback loop through in / load is legal.
 * The stored value is masked to the width (a Register never holds more than 16 bits).
 */
function loadRegisterChip(name: string, width: number): ChipDef {
  return seqChip(name, [p('in', width), p('load')], [p('out', width)], {
    combInputs: [],
    init: (): Reg => ({ cur: 0, next: 0 }),
    read: (_inp, s) => ({ out: (s as Reg).cur }),
    tick: (inp, s) => {
      const r = s as Reg
      r.next = inp.load ? mask(inp.in, width) : r.cur
    },
    tock: (s) => void ((s as Reg).cur = (s as Reg).next),
    stored: (s) => (s as Reg).cur,
  })
}

type Mem = { mem: Uint16Array; pending: [number, number] | null }

/** RAM with 2^addrBits 16-bit words. Reading is combinational; writing happens at tock. */
function ramChip(name: string, addrBits: number): ChipDef {
  return seqChip(
    name,
    [p('in', W), p('load'), p('address', addrBits)],
    [p('out', W)],
    {
      combInputs: ['address'], // out = memory[address] right now; in / load only matter at the tick
      init: (): Mem => ({ mem: new Uint16Array(1 << addrBits), pending: null }),
      read: (inp, s) => ({ out: (s as Mem).mem[inp.address] ?? 0 }),
      tick: (inp, s) => void ((s as Mem).pending = inp.load ? [inp.address, inp.in] : null),
      tock: (s) => {
        const m = s as Mem
        if (m.pending) m.mem[m.pending[0]] = m.pending[1]
        m.pending = null
      },
    },
  )
}

/** Program counter. Priority: reset > load > inc. */
const pc = seqChip('PC', [p('in', W), p('load'), p('inc'), p('reset')], [p('out', W)], {
  combInputs: [],
  init: (): Reg => ({ cur: 0, next: 0 }),
  read: (_inp, s) => ({ out: (s as Reg).cur }),
  tick: (inp, s) => {
    const r = s as Reg
    r.next = inp.reset ? 0 : inp.load ? inp.in : inp.inc ? mask(r.cur + 1, W) : r.cur
  },
  tock: (s) => void ((s as Reg).cur = (s as Reg).next),
  stored: (s) => (s as Reg).cur,
})

const seqDefs: ChipDef[] = [
  dffChip('DFF', 1),
  // Stand-in for 16 DFFs: real Register = 16 Bits, which needs bus slicing (a later stage).
  dffChip('DFF16', W),
  loadRegisterChip('Bit', 1),
  loadRegisterChip('Register', W),
  loadRegisterChip('ARegister', W), // the Hack CPU's A register: same pins and behaviour as Register
  loadRegisterChip('DRegister', W), // the Hack CPU's D register
  ramChip('RAM8', 3),
  ramChip('RAM64', 6),
  ramChip('RAM512', 9),
  ramChip('RAM4K', 12),
  ramChip('RAM16K', 14),
  pc,
]

// Project 5 memory chips live in projectFive.ts (they only need the ChipDef type from this file).
const allDefs: ChipDef[] = [...defs, ...seqDefs, ...PROJECT5_CHIPS]

export const CHIPS: Record<string, ChipDef> = Object.fromEntries(allDefs.map((d) => [d.name, d]))
export const CHIP_NAMES: string[] = allDefs.map((d) => d.name)

/** The inputs one OUTPUT of a clocked chip depends on right now: its `deps` entry, else every `combInputs`. */
export const outputDeps = (seq: SeqBehavior, output: string): readonly string[] => seq.deps?.[output] ?? seq.combInputs

/** Palette sections, one per Nand2Tetris project. */
export const CHIP_GROUPS: { title: string; chips: string[] }[] = [
  {
    title: 'Project 1 – Boolean Logic',
    chips: [
      'Nand', 'Not', 'And', 'Or', 'Xor', 'Mux', 'DMux', 'Not16', 'And16', 'Or16',
      'Mux16', 'Or8Way', 'Mux4Way16', 'Mux8Way16', 'DMux4Way', 'DMux8Way',
    ],
  },
  {
    title: 'Project 2 – Boolean Arithmetic',
    chips: ['HalfAdder', 'FullAdder', 'Add16', 'Inc16', 'ALU'],
  },
  {
    // Built-ins for speed and for use as blocks. When an exercise folder contains a chip with the
    // SAME name (say Bit or RAM8) and it is the chip under test, the sidebar hides the built-in
    // (see ui/palette.ts), so the chip cannot be built out of itself.
    title: 'Project 3 – Memory',
    chips: ['DFF', 'DFF16', 'Bit', 'Register', 'ARegister', 'DRegister', 'PC', 'RAM8', 'RAM64', 'RAM512', 'RAM4K', 'RAM16K'],
  },
  {
    // Program memory (loaded from a .hack file), the screen, the keyboard and the Hack data memory map.
    title: 'Project 5 – Computer',
    chips: ['ROM32K', 'Screen', 'Keyboard', 'Memory', 'CPU', 'Computer'],
  },
]
