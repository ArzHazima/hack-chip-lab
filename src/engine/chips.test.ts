import { describe, expect, it } from 'vitest'
import { CHIPS, CHIP_GROUPS, CHIP_NAMES } from './chips'

const ev = (name: string, inp: Record<string, number>) => CHIPS[name].eval(inp)
const bits = [0, 1]

describe('built-in chips', () => {
  it('defines all 39 chips and every one appears in exactly one palette group', () => {
    expect(CHIP_NAMES).toHaveLength(39)
    const grouped = CHIP_GROUPS.flatMap((g) => g.chips)
    expect([...grouped].sort()).toEqual([...CHIP_NAMES].sort())
  })

  it('HalfAdder', () => {
    for (const a of bits) for (const b of bits) {
      expect(ev('HalfAdder', { a, b })).toEqual({ sum: (a + b) & 1, carry: (a + b) >> 1 })
    }
  })

  it('FullAdder', () => {
    for (const a of bits) for (const b of bits) for (const c of bits) {
      expect(ev('FullAdder', { a, b, c })).toEqual({ sum: (a + b + c) & 1, carry: (a + b + c) >> 1 })
    }
  })

  it('Add16 wraps on overflow', () => {
    expect(ev('Add16', { a: 1, b: 2 }).out).toBe(3)
    expect(ev('Add16', { a: 0xffff, b: 1 }).out).toBe(0)
    expect(ev('Add16', { a: 0xffff, b: 0xffff }).out).toBe(0xfffe)
  })

  it('Inc16 wraps on overflow', () => {
    expect(ev('Inc16', { in: 0 }).out).toBe(1)
    expect(ev('Inc16', { in: 0xffff }).out).toBe(0)
  })

  it('ALU computes every official function with correct zr/ng flags', () => {
    const x = 0x0003
    const y = 0xfffd // -3 in two's complement
    const m = (v: number) => v & 0xffff
    // [zx, nx, zy, ny, f, no, expected out]  (the 18 functions of the Hack ALU spec)
    const table: [number, number, number, number, number, number, number][] = [
      [1, 0, 1, 0, 1, 0, 0],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 0, 1, 0, 0xffff],
      [0, 0, 1, 1, 0, 0, x],
      [1, 1, 0, 0, 0, 0, y],
      [0, 0, 1, 1, 0, 1, m(~x)],
      [1, 1, 0, 0, 0, 1, m(~y)],
      [0, 0, 1, 1, 1, 1, m(-x)],
      [1, 1, 0, 0, 1, 1, m(-y)],
      [0, 1, 1, 1, 1, 1, m(x + 1)],
      [1, 1, 0, 1, 1, 1, m(y + 1)],
      [0, 0, 1, 1, 1, 0, m(x - 1)],
      [1, 1, 0, 0, 1, 0, m(y - 1)],
      [0, 0, 0, 0, 1, 0, m(x + y)],
      [0, 1, 0, 0, 1, 1, m(x - y)],
      [0, 0, 0, 1, 1, 1, m(y - x)],
      [0, 0, 0, 0, 0, 0, x & y],
      [0, 1, 0, 1, 0, 1, x | y],
    ]
    for (const [zx, nx, zy, ny, f, no, want] of table) {
      const out = ev('ALU', { x, y, zx, nx, zy, ny, f, no })
      expect(out.out, `zx${zx} nx${nx} zy${zy} ny${ny} f${f} no${no}`).toBe(want)
      expect(out.zr).toBe(want === 0 ? 1 : 0)
      expect(out.ng).toBe(want >= 0x8000 ? 1 : 0)
    }
  })

  it('Nand', () => {
    // [a, b, out]
    for (const [a, b, out] of [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]]) {
      expect(ev('Nand', { a, b })).toEqual({ out })
    }
  })

  it('Not', () => {
    expect(ev('Not', { in: 0 })).toEqual({ out: 1 })
    expect(ev('Not', { in: 1 })).toEqual({ out: 0 })
  })

  it('And / Or / Xor', () => {
    for (const a of bits) {
      for (const b of bits) {
        expect(ev('And', { a, b }).out).toBe(a && b ? 1 : 0)
        expect(ev('Or', { a, b }).out).toBe(a || b ? 1 : 0)
        expect(ev('Xor', { a, b }).out).toBe(a !== b ? 1 : 0)
      }
    }
  })

  it('Mux', () => {
    for (const a of bits) for (const b of bits) {
      expect(ev('Mux', { a, b, sel: 0 }).out).toBe(a)
      expect(ev('Mux', { a, b, sel: 1 }).out).toBe(b)
    }
  })

  it('DMux', () => {
    for (const i of bits) {
      expect(ev('DMux', { in: i, sel: 0 })).toEqual({ a: i, b: 0 })
      expect(ev('DMux', { in: i, sel: 1 })).toEqual({ a: 0, b: i })
    }
  })

  it('Not16 masks to 16 bits', () => {
    expect(ev('Not16', { in: 0 }).out).toBe(0xffff)
    expect(ev('Not16', { in: 0xffff }).out).toBe(0)
    expect(ev('Not16', { in: 0x00ff }).out).toBe(0xff00)
  })

  it('And16 / Or16', () => {
    expect(ev('And16', { a: 0xf0f0, b: 0xff00 }).out).toBe(0xf000)
    expect(ev('Or16', { a: 0xf0f0, b: 0x0f00 }).out).toBe(0xfff0)
  })

  it('Mux16', () => {
    expect(ev('Mux16', { a: 0x1234, b: 0xabcd, sel: 0 }).out).toBe(0x1234)
    expect(ev('Mux16', { a: 0x1234, b: 0xabcd, sel: 1 }).out).toBe(0xabcd)
  })

  it('Or8Way', () => {
    expect(ev('Or8Way', { in: 0 }).out).toBe(0)
    for (let k = 0; k < 8; k++) expect(ev('Or8Way', { in: 1 << k }).out).toBe(1)
    expect(ev('Or8Way', { in: 0xff }).out).toBe(1)
  })

  it('Mux4Way16 selects a..d', () => {
    const data = { a: 1, b: 2, c: 3, d: 4 }
    for (let sel = 0; sel < 4; sel++) expect(ev('Mux4Way16', { ...data, sel }).out).toBe(sel + 1)
  })

  it('Mux8Way16 selects a..h', () => {
    const data = { a: 10, b: 20, c: 30, d: 40, e: 50, f: 60, g: 70, h: 80 }
    for (let sel = 0; sel < 8; sel++) expect(ev('Mux8Way16', { ...data, sel }).out).toBe((sel + 1) * 10)
  })

  it('DMux4Way routes input to exactly one output', () => {
    const names = ['a', 'b', 'c', 'd']
    for (let sel = 0; sel < 4; sel++) {
      const out = ev('DMux4Way', { in: 1, sel })
      names.forEach((n, k) => expect(out[n]).toBe(k === sel ? 1 : 0))
      expect(Object.values(ev('DMux4Way', { in: 0, sel })).every((v) => v === 0)).toBe(true)
    }
  })

  it('DMux8Way routes input to exactly one output', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    for (let sel = 0; sel < 8; sel++) {
      const out = ev('DMux8Way', { in: 1, sel })
      names.forEach((n, k) => expect(out[n]).toBe(k === sel ? 1 : 0))
    }
  })
})
