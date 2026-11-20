// Built-in chip definitions. Each chip is a "black box": named input/output pins
// with bit widths, plus a pure `eval` function mapping input values to output values.
// Signals are plain numbers; a 16-bit bus is a number in 0..65535.

export interface PinDef {
  name: string
  width: number
}

export interface ChipDef {
  name: string
  inputs: PinDef[]
  outputs: PinDef[]
  eval: (inp: Record<string, number>) => Record<string, number>
}

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

export const CHIPS: Record<string, ChipDef> = Object.fromEntries(defs.map((d) => [d.name, d]))
export const CHIP_NAMES: string[] = defs.map((d) => d.name)

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
]
