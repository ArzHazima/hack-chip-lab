// Built-in chip definitions. Each chip is a "black box": named input/output pins
// with bit widths, plus a pure `eval` function mapping input values to output values.
// Signals are plain numbers; a 16-bit bus is a number in 0..65535.

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
  /** True if the outputs depend only on the stored state, never on the present inputs
   *  (DFF, PC). This is what lets a feedback loop through such a chip be legal. */
  registered: boolean
  init(): unknown
  /** Current outputs, from the stored state (and, for RAM, the address input). */
  read(inp: Record<string, number>, state: unknown): Record<string, number>
  tick(inp: Record<string, number>, state: unknown): void
  tock(state: unknown): void
  /** A single number to show live on the board (DFF bit, PC counter); undefined = none. */
  stored?(state: unknown): number | undefined
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
    registered: true,
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
 * Registered: the output comes from the stored value only, so a feedback loop through one is legal.
 * The stored value is masked to the width (a Register never holds more than 16 bits).
 */
function loadRegisterChip(name: string, width: number): ChipDef {
  return seqChip(name, [p('in', width), p('load')], [p('out', width)], {
    registered: true,
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
      registered: false, // out depends on the address input right now
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
  registered: true,
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

export const CHIPS: Record<string, ChipDef> = Object.fromEntries(
  [...defs, ...seqDefs].map((d) => [d.name, d]),
)
export const CHIP_NAMES: string[] = [...defs, ...seqDefs].map((d) => d.name)

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
]
