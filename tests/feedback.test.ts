// Feedback loops through the INPUTS of clocked chips (in / load / inc ...) are legal, like in the
// Nand2Tetris hardware simulator: those inputs are only sampled at the clock tick, so they create no
// combinational dependency. Only a loop through a combinational path is an error:
// a pure gate loop, or RAM.out -> RAM.address (a RAM's out depends on its address immediately).

import { describe, expect, it } from 'vitest'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from '../src/engine/circuit'
import { runExercise } from '../src/engine/exercise'
import { CircuitError } from '../src/engine/simulate'
import { Simulator } from '../src/engine/sequential'

const ONES = { width: 1, ones: true }
const bit0 = { width: 16, ranges: [{ lo: 0, hi: 0 }] }

/** RAM8 whose load is Not(out bit 0) and whose in is 0xFFFF: it writes each address once. */
function selfGatedRam(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'addr', 'addr', 'input', 3)
  c = addPin(c, 'out', 'out', 'output', 16)
  c = addChip(c, 'ram', 'RAM8')
  c = addChip(c, 'one', 'Const', { width: 16, ones: true })
  c = addChip(c, 'bit', 'Split', bit0)
  c = addChip(c, 'not', 'Not')
  c = connect(c, { pin: 'addr' }, { chip: 'ram', pin: 'address' })
  c = connect(c, { chip: 'one', pin: 'out' }, { chip: 'ram', pin: 'in' })
  c = connect(c, { chip: 'ram', pin: 'out' }, { chip: 'bit', pin: 'in' })
  c = connect(c, { chip: 'bit', pin: '[0]' }, { chip: 'not', pin: 'in' })
  c = connect(c, { chip: 'not', pin: 'out' }, { chip: 'ram', pin: 'load' }) // the loop
  c = connect(c, { chip: 'ram', pin: 'out' }, { pin: 'out' })
  return c
}

describe('(a) a loop RAM8.out -> logic -> RAM8.load works', () => {
  it('gives the right values over several clock steps', () => {
    const sim = new Simulator(selfGatedRam())
    const outAt = (addr: number) => sim.eval({ addr }).outputs.out
    expect(outAt(5)).toBe(0)
    sim.step({ addr: 5 }) // out was 0, so load = 1: 0xFFFF is written
    expect(outAt(5)).toBe(0xffff)
    sim.step({ addr: 5 }) // out is 0xFFFF now, so load = 0: nothing changes
    sim.step({ addr: 5 })
    expect(outAt(5)).toBe(0xffff)
    expect(outAt(6)).toBe(0) // other words untouched
    sim.step({ addr: 6 })
    expect(outAt(6)).toBe(0xffff)
  })
})

describe('(b) RAM.out -> RAM.address is still a combinational cycle', () => {
  it('is rejected with the cycle message', () => {
    let c = emptyCircuit()
    c = addPin(c, 'w', 'w', 'input')
    c = addPin(c, 'd', 'd', 'input', 16)
    c = addPin(c, 'out', 'out', 'output', 16)
    c = addChip(c, 'ram', 'RAM8')
    c = addChip(c, 'sp', 'Split', { width: 16, ranges: [{ lo: 0, hi: 2 }] })
    c = connect(c, { pin: 'w' }, { chip: 'ram', pin: 'load' })
    c = connect(c, { pin: 'd' }, { chip: 'ram', pin: 'in' })
    c = connect(c, { chip: 'ram', pin: 'out' }, { chip: 'sp', pin: 'in' })
    c = connect(c, { chip: 'sp', pin: '[0..2]' }, { chip: 'ram', pin: 'address' })
    c = connect(c, { chip: 'ram', pin: 'out' }, { pin: 'out' })
    expect(() => new Simulator(c)).toThrow(CircuitError)
    expect(() => new Simulator(c)).toThrow(/Cycle detected.*ram.*sp/)
  })
})

describe('(c) loops through Bit / Register / DFF / PC inputs work', () => {
  it('Bit.out -> Not -> Bit.load', () => {
    let c = emptyCircuit()
    c = addPin(c, 'out', 'out', 'output')
    c = addChip(c, 'bit', 'Bit')
    c = addChip(c, 'not', 'Not')
    c = addChip(c, 'one', 'Const', ONES)
    c = connect(c, { chip: 'one', pin: 'out' }, { chip: 'bit', pin: 'in' })
    c = connect(c, { chip: 'bit', pin: 'out' }, { chip: 'not', pin: 'in' })
    c = connect(c, { chip: 'not', pin: 'out' }, { chip: 'bit', pin: 'load' })
    c = connect(c, { chip: 'bit', pin: 'out' }, { pin: 'out' })
    const sim = new Simulator(c)
    const seen = [sim.eval({}).outputs.out]
    for (let i = 0; i < 3; i++) seen.push(sim.step({}).outputs.out)
    expect(seen).toEqual([0, 1, 1, 1])
  })

  it('Register.out -> Inc16 -> Register.in counts', () => {
    let c = emptyCircuit()
    c = addPin(c, 'out', 'out', 'output', 16)
    c = addChip(c, 'reg', 'Register')
    c = addChip(c, 'inc', 'Inc16')
    c = addChip(c, 'one', 'Const', ONES)
    c = connect(c, { chip: 'reg', pin: 'out' }, { chip: 'inc', pin: 'in' })
    c = connect(c, { chip: 'inc', pin: 'out' }, { chip: 'reg', pin: 'in' })
    c = connect(c, { chip: 'one', pin: 'out' }, { chip: 'reg', pin: 'load' })
    c = connect(c, { chip: 'reg', pin: 'out' }, { pin: 'out' })
    const sim = new Simulator(c)
    const seen = [0, 1, 2, 3].map(() => sim.step({}).outputs.out)
    expect(seen).toEqual([1, 2, 3, 4])
  })

  it('DFF.out -> Not -> DFF.in toggles', () => {
    let c = emptyCircuit()
    c = addPin(c, 'out', 'out', 'output')
    c = addChip(c, 'dff', 'DFF')
    c = addChip(c, 'not', 'Not')
    c = connect(c, { chip: 'dff', pin: 'out' }, { chip: 'not', pin: 'in' })
    c = connect(c, { chip: 'not', pin: 'out' }, { chip: 'dff', pin: 'in' })
    c = connect(c, { chip: 'dff', pin: 'out' }, { pin: 'out' })
    const sim = new Simulator(c)
    expect([0, 1, 2].map(() => sim.step({}).outputs.out)).toEqual([1, 0, 1])
  })

  it('PC.out -> Inc16 -> PC.in (loop through in) counts', () => {
    let c = emptyCircuit()
    c = addPin(c, 'out', 'out', 'output', 16)
    c = addChip(c, 'pc', 'PC')
    c = addChip(c, 'inc', 'Inc16')
    c = addChip(c, 'one', 'Const', ONES)
    c = addChip(c, 'zero', 'Const', { width: 1, ones: false })
    c = connect(c, { chip: 'pc', pin: 'out' }, { chip: 'inc', pin: 'in' })
    c = connect(c, { chip: 'inc', pin: 'out' }, { chip: 'pc', pin: 'in' })
    c = connect(c, { chip: 'one', pin: 'out' }, { chip: 'pc', pin: 'load' })
    c = connect(c, { chip: 'zero', pin: 'out' }, { chip: 'pc', pin: 'inc' })
    c = connect(c, { chip: 'zero', pin: 'out' }, { chip: 'pc', pin: 'reset' })
    c = connect(c, { chip: 'pc', pin: 'out' }, { pin: 'out' })
    const sim = new Simulator(c)
    expect([0, 1, 2].map(() => sim.step({}).outputs.out)).toEqual([1, 2, 3])
  })
})

describe('(d) a pure gate feedback loop is still rejected', () => {
  it('two cross-coupled Nand chips', () => {
    let c = emptyCircuit()
    c = addPin(c, 's', 's', 'input')
    c = addPin(c, 'r', 'r', 'input')
    c = addPin(c, 'q', 'q', 'output')
    c = addChip(c, 'n1', 'Nand')
    c = addChip(c, 'n2', 'Nand')
    c = connect(c, { pin: 's' }, { chip: 'n1', pin: 'a' })
    c = connect(c, { chip: 'n2', pin: 'out' }, { chip: 'n1', pin: 'b' })
    c = connect(c, { pin: 'r' }, { chip: 'n2', pin: 'a' })
    c = connect(c, { chip: 'n1', pin: 'out' }, { chip: 'n2', pin: 'b' })
    c = connect(c, { chip: 'n1', pin: 'out' }, { pin: 'q' })
    expect(() => new Simulator(c)).toThrow(/Cycle detected.*n1.*n2.*A loop is only allowed/)
  })
})

// ---- (e) the WriteOnceRAM8 fixture, built the way a student would ----
const raw = import.meta.glob('./fixtures/memory/WriteOnceRAM8.*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const file = (ext: string): string => raw[`./fixtures/memory/WriteOnceRAM8.${ext}`]

function writeOnceRam8(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'in', 'in', 'input', 16)
  c = addPin(c, 'load', 'load', 'input')
  c = addPin(c, 'address', 'address', 'input', 3)
  c = addPin(c, 'out', 'out', 'output', 16)
  c = addPin(c, 'valid', 'valid', 'output')
  c = addChip(c, 'flags', 'RAM8')
  c = addChip(c, 'data', 'RAM8')
  c = addChip(c, 'ones', 'Const', { width: 16, ones: true })
  c = addChip(c, 'bit', 'Split', bit0)
  c = addChip(c, 'not', 'Not')
  c = addChip(c, 'and', 'And')
  c = connect(c, { pin: 'address' }, { chip: 'flags', pin: 'address' })
  c = connect(c, { pin: 'address' }, { chip: 'data', pin: 'address' })
  c = connect(c, { chip: 'ones', pin: 'out' }, { chip: 'flags', pin: 'in' })
  c = connect(c, { pin: 'in' }, { chip: 'data', pin: 'in' })
  c = connect(c, { chip: 'flags', pin: 'out' }, { chip: 'bit', pin: 'in' })
  c = connect(c, { chip: 'bit', pin: '[0]' }, { chip: 'not', pin: 'in' })
  c = connect(c, { pin: 'load' }, { chip: 'and', pin: 'a' })
  c = connect(c, { chip: 'not', pin: 'out' }, { chip: 'and', pin: 'b' })
  c = connect(c, { chip: 'and', pin: 'out' }, { chip: 'flags', pin: 'load' }) // loop through flags
  c = connect(c, { chip: 'and', pin: 'out' }, { chip: 'data', pin: 'load' })
  c = connect(c, { chip: 'data', pin: 'out' }, { pin: 'out' })
  c = connect(c, { chip: 'and', pin: 'out' }, { pin: 'valid' })
  return c
}

describe('(e) the WriteOnceRAM8 fixture', () => {
  it('passes its .tst / .cmp (all 8 rows)', () => {
    const r = runExercise(writeOnceRam8(), file('tst'), file('cmp'))
    expect(r.rows.filter((x) => !x.pass).map((x) => `${x.expected}  vs  ${x.actual}`)).toEqual([])
    expect(r.passed).toBe(8)
    expect(r.total).toBe(8)
  })
})
