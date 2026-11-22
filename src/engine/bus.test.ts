import { describe, expect, it } from 'vitest'
import { busDef, busErrors, parseRanges, rangeName } from './bus'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { CircuitError, simulate, validateCircuit } from './simulate'

describe('parseRanges', () => {
  it('reads bits and ranges, brackets optional, any separators', () => {
    expect(parseRanges('0..7, 8..15', 16).ranges).toEqual([{ lo: 0, hi: 7 }, { lo: 8, hi: 15 }])
    expect(parseRanges('[3] [4..5]\n6', 16).ranges).toEqual([{ lo: 3, hi: 3 }, { lo: 4, hi: 5 }, { lo: 6, hi: 6 }])
  })

  it('empty text means every bit on its own', () => {
    const { ranges } = parseRanges('  ', 4)
    expect(ranges.map(rangeName)).toEqual(['[0]', '[1]', '[2]', '[3]'])
  })

  it('reports syntax errors', () => {
    expect(parseRanges('a..b', 8).error).toMatch(/Bad range "a..b"/)
    expect(parseRanges('7..0', 8).error).toMatch(/low bit to the high bit/)
    expect(parseRanges('1...3', 8).error).toMatch(/Bad range/)
  })
})

describe('Split / Join / Const definitions', () => {
  it('Split: single bits and ranges, bit 0 is the least significant', () => {
    const def = busDef('Split', { width: 16, ranges: [{ lo: 0, hi: 0 }, { lo: 15, hi: 15 }, { lo: 0, hi: 7 }, { lo: 8, hi: 15 }] })
    expect(def.inputs).toEqual([{ name: 'in', width: 16 }])
    expect(def.outputs).toEqual([
      { name: '[0]', width: 1 }, { name: '[15]', width: 1 }, { name: '[0..7]', width: 8 }, { name: '[8..15]', width: 8 },
    ])
    expect(def.eval({ in: 0xa5c3 })).toEqual({ '[0]': 1, '[15]': 1, '[0..7]': 0xc3, '[8..15]': 0xa5 })
  })

  it('Join: places each input at its bits', () => {
    const def = busDef('Join', { width: 16, ranges: [{ lo: 0, hi: 7 }, { lo: 8, hi: 15 }] })
    expect(def.inputs).toEqual([{ name: '[0..7]', width: 8 }, { name: '[8..15]', width: 8 }])
    expect(def.outputs).toEqual([{ name: 'out', width: 16 }])
    expect(def.eval({ '[0..7]': 0xc3, '[8..15]': 0xa5 })).toEqual({ out: 0xa5c3 })
  })

  it('Const: true is all ones of the chosen width, false is zero', () => {
    expect(busDef('Const', { width: 16, ones: true }).eval({})).toEqual({ out: 0xffff })
    expect(busDef('Const', { width: 3, ones: true }).eval({})).toEqual({ out: 7 })
    expect(busDef('Const', { width: 1, ones: true }).eval({})).toEqual({ out: 1 })
    expect(busDef('Const', { width: 8, ones: false }).eval({})).toEqual({ out: 0 })
    expect(busDef('Const', { width: 8 }).inputs).toEqual([])
  })
})

describe('pin widths in a circuit', () => {
  it('a circuit pin wider than 16 bits is an error; 16 is fine', () => {
    const wide = addPin(emptyCircuit(), 'a', 'a', 'input', 17)
    expect(validateCircuit(wide)).toEqual(['Pin "a" is 17 bits wide; the maximum is 16'])
    expect(validateCircuit(addPin(emptyCircuit(), 'a', 'a', 'input', 16))).toEqual([])
    expect(validateCircuit(addPin(emptyCircuit(), 'a', 'a', 'input', 0))[0]).toMatch(/Pin "a"/)
  })
})

describe('busErrors (validation of the settings)', () => {
  const r = (lo: number, hi = lo) => ({ lo, hi })

  it('accepts valid settings', () => {
    expect(busErrors('s', 'Split', { width: 16, ranges: [r(0, 7), r(8, 15)] })).toEqual([])
    expect(busErrors('j', 'Join', { width: 16, ranges: [r(0, 7), r(8, 15)] })).toEqual([])
    expect(busErrors('j', 'Join', { width: 4 })).toEqual([]) // default: every bit on its own
    expect(busErrors('c', 'Const', { width: 16, ones: true })).toEqual([])
  })

  it('rejects a bad width or missing settings', () => {
    expect(busErrors('c', 'Const', { width: 0 })[0]).toMatch(/width must be a whole number from 1 to 16/)
    expect(busErrors('c', 'Const', { width: 17 })[0]).toMatch(/1 to 16/)
    expect(busErrors('c', 'Const', { width: 2.5 })[0]).toMatch(/1 to 16/)
    expect(busErrors('c', 'Const', undefined)[0]).toMatch(/missing settings/)
  })

  it('range width checks: a range outside the bus is an error', () => {
    expect(busErrors('s', 'Split', { width: 8, ranges: [r(4, 11)] })[0]).toMatch(/range \[4\.\.11\] is outside the bus \(bits 0\.\.7\)/)
    expect(busErrors('j', 'Join', { width: 8, ranges: [r(0, 8)] })[0]).toMatch(/outside the bus/)
  })

  it('overlapping ranges: an error on a Join, harmless on a Split', () => {
    const msg = busErrors('j', 'Join', { width: 12, ranges: [r(0, 7), r(4, 11)] })
    expect(msg).toHaveLength(1)
    expect(msg[0]).toMatch(/overlap, so bits 4\.\.7 would be driven twice/)
    expect(busErrors('s', 'Split', { width: 12, ranges: [r(0, 7), r(4, 11)] })).toEqual([]) // reading a bit twice is fine
  })

  it('undriven bits on a Join are listed', () => {
    const msg = busErrors('j', 'Join', { width: 16, ranges: [r(0, 3), r(8, 11), r(15)] })
    expect(msg).toEqual(['Join j: bits 4..7, 12..14 of the 16-bit output are not driven by any input range'])
  })

  it('a range listed twice and an empty list are errors', () => {
    expect(busErrors('s', 'Split', { width: 8, ranges: [r(0, 3), r(0, 3)] })[0]).toMatch(/listed twice/)
    expect(busErrors('s', 'Split', { width: 8, ranges: [] })[0]).toMatch(/no ranges/)
  })
})

// ---------------------------------------------------------------------------
// Whole circuits

/** Split 16 into bytes, swap them, join again. */
function byteSwap(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'in', 'in', 'input', 16)
  c = addPin(c, 'out', 'out', 'output', 16)
  c = addChip(c, 'sp', 'Split', { width: 16, ranges: [{ lo: 0, hi: 7 }, { lo: 8, hi: 15 }] })
  c = addChip(c, 'jn', 'Join', { width: 16, ranges: [{ lo: 0, hi: 7 }, { lo: 8, hi: 15 }] })
  c = connect(c, { pin: 'in' }, { chip: 'sp', pin: 'in' })
  c = connect(c, { chip: 'sp', pin: '[0..7]' }, { chip: 'jn', pin: '[8..15]' })
  c = connect(c, { chip: 'sp', pin: '[8..15]' }, { chip: 'jn', pin: '[0..7]' })
  return connect(c, { chip: 'jn', pin: 'out' }, { pin: 'out' })
}

describe('circuits with wiring nodes', () => {
  it('Split + Join swap the two bytes', () => {
    expect(simulate(byteSwap(), { in: 0x12ab }).outputs.out).toBe(0xab12)
  })

  it('wire values are reported for every wire (used to colour the board)', () => {
    const { wireValues } = simulate(byteSwap(), { in: 0x12ab })
    // w1 in -> Split, w2 low byte -> Join, w3 high byte -> Join, w4 Join -> out
    expect(wireValues).toEqual({ w1: 0x12ab, w2: 0xab, w3: 0x12, w4: 0xab12 })
  })

  it('Const feeds a circuit: true16 with the low byte taken from an input', () => {
    let c = emptyCircuit()
    c = addPin(c, 'x', 'x', 'input', 8)
    c = addPin(c, 'out', 'out', 'output', 16)
    c = addChip(c, 'hi', 'Const', { width: 8, ones: true })
    c = addChip(c, 'jn', 'Join', { width: 16, ranges: [{ lo: 0, hi: 7 }, { lo: 8, hi: 15 }] })
    c = connect(c, { pin: 'x' }, { chip: 'jn', pin: '[0..7]' })
    c = connect(c, { chip: 'hi', pin: 'out' }, { chip: 'jn', pin: '[8..15]' })
    c = connect(c, { chip: 'jn', pin: 'out' }, { pin: 'out' })
    expect(simulate(c, { x: 0x5a }).outputs.out).toBe(0xff5a)
  })

  it('width mismatch into a range pin is reported with the pin names', () => {
    let c = byteSwap()
    c = addPin(c, 'bit', 'bit', 'input', 1)
    c.wires = c.wires.map((w) => (w.id === 'w2' ? { ...w, from: { pin: 'bit' } } : w)) // 1 bit into [8..15] (8 bits)
    expect(() => simulate(c, { in: 0, bit: 0 })).toThrow(/Width mismatch.*1 bit\(s\) → 8 bit\(s\)/)
  })

  it('an unconnected Join input is reported like any unconnected pin', () => {
    const c = byteSwap()
    c.wires = c.wires.filter((w) => w.id !== 'w3')
    expect(validateCircuit(c)).toEqual(['Unconnected input pin: jn.[0..7]'])
  })

  it('a bad Join (undriven bits) stops the run with a clear error', () => {
    const c = byteSwap()
    c.chips = c.chips.map((x) => (x.id === 'jn' ? { ...x, params: { width: 16, ranges: [{ lo: 0, hi: 7 }] } } : x))
    c.wires = c.wires.filter((w) => w.id !== 'w2')
    try {
      simulate(c, { in: 0 })
      throw new Error('expected an error')
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitError)
      expect((e as CircuitError).errors.join('\n')).toMatch(/Join jn: bits 8\.\.15 of the 16-bit output are not driven/)
    }
  })

  it('unused Split outputs are fine (only inputs and circuit outputs must be driven)', () => {
    let c = emptyCircuit()
    c = addPin(c, 'in', 'in', 'input', 16)
    c = addPin(c, 'msb', 'msb', 'output', 1)
    c = addChip(c, 'sp', 'Split', { width: 16, ranges: [{ lo: 15, hi: 15 }, { lo: 0, hi: 14 }] })
    c = connect(c, { pin: 'in' }, { chip: 'sp', pin: 'in' })
    c = connect(c, { chip: 'sp', pin: '[15]' }, { pin: 'msb' })
    expect(simulate(c, { in: 0x8000 }).outputs.msb).toBe(1)
    expect(simulate(c, { in: 0x7fff }).outputs.msb).toBe(0)
  })
})
