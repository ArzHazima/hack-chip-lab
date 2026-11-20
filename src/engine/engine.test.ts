import { describe, expect, it } from 'vitest'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { CmpParseError, parseCmp } from './cmp'
import { runTests } from './runTests'
import { CircuitError, simulate } from './simulate'

// Xor(a,b) = And( Or(a,b), Not(And(a,b)) )
function xorCircuit(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'a', 'a', 'input')
  c = addPin(c, 'b', 'b', 'input')
  c = addPin(c, 'o', 'out', 'output')
  c = addChip(c, 'or1', 'Or')
  c = addChip(c, 'and1', 'And')
  c = addChip(c, 'not1', 'Not')
  c = addChip(c, 'and2', 'And')
  c = connect(c, { pin: 'a' }, { chip: 'or1', pin: 'a' })
  c = connect(c, { pin: 'b' }, { chip: 'or1', pin: 'b' })
  c = connect(c, { pin: 'a' }, { chip: 'and1', pin: 'a' })
  c = connect(c, { pin: 'b' }, { chip: 'and1', pin: 'b' })
  c = connect(c, { chip: 'and1', pin: 'out' }, { chip: 'not1', pin: 'in' })
  c = connect(c, { chip: 'or1', pin: 'out' }, { chip: 'and2', pin: 'a' })
  c = connect(c, { chip: 'not1', pin: 'out' }, { chip: 'and2', pin: 'b' })
  c = connect(c, { chip: 'and2', pin: 'out' }, { pin: 'o' })
  return c
}

const XOR_CMP = `
|  a  |  b  | out |
|  0  |  0  |  0  |
|  0  |  1  |  1  |
|  1  |  0  |  1  |
|  1  |  1  |  0  |
`

function errorsOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (e) {
    if (e instanceof CircuitError) return e.errors
    throw e
  }
  throw new Error('expected CircuitError')
}

describe('parseCmp', () => {
  it('parses header, padded rows and widths', () => {
    const cmp = parseCmp('|  a  | out |\r\n| 0000000000001111 |   1 |\n')
    expect(cmp.columns).toEqual(['a', 'out'])
    expect(cmp.widths).toEqual([16, 1])
    expect(cmp.rows[0].values).toEqual([15, 1])
  })

  it('rejects bad input', () => {
    expect(() => parseCmp('')).toThrow(CmpParseError)
    expect(() => parseCmp('| a |\n| 2 |')).toThrow(/binary/)
    expect(() => parseCmp('| a | b |\n| 0 |')).toThrow(/expected 2/)
    expect(() => parseCmp('| a |\n| 0 |\n| 00 |')).toThrow(/width/)
    expect(() => parseCmp('| a |')).toThrow(/no data rows/)
  })
})

describe('Xor circuit built from And/Or/Not', () => {
  it('simulates correctly', () => {
    expect(simulate(xorCircuit(), { a: 1, b: 0 }).outputs).toEqual({ out: 1 })
    expect(simulate(xorCircuit(), { a: 1, b: 1 }).outputs).toEqual({ out: 0 })
  })

  it('passes the sample Xor.cmp', () => {
    const run = runTests(xorCircuit(), parseCmp(XOR_CMP))
    expect(run.total).toBe(4)
    expect(run.passed).toBe(4)
    expect(run.rows.every((r) => r.pass)).toBe(true)
  })

  it('reports failing rows and the wrong output column', () => {
    const bad = XOR_CMP.replace('|  1  |  1  |  0  |', '|  1  |  1  |  1  |')
    const run = runTests(xorCircuit(), parseCmp(bad))
    expect(run.passed).toBe(3)
    expect(run.rows[3].pass).toBe(false)
    expect(run.rows[3].failedOutputs).toEqual(['out'])
    expect(run.rows[3].actual).toEqual({ out: 0 })
  })

  it('exposes per-wire values for coloring', () => {
    const { wireValues } = simulate(xorCircuit(), { a: 1, b: 0 })
    expect(wireValues['w1']).toBe(1) // a -> or1.a
    expect(wireValues['w2']).toBe(0) // b -> or1.b
  })

  it('errors when the .cmp has an unknown column', () => {
    const errs = errorsOf(() => runTests(xorCircuit(), parseCmp('| a | b | z |\n| 0 | 0 | 0 |')))
    expect(errs.join()).toMatch(/Column "z"/)
  })
})

describe('circuit errors', () => {
  it('detects a cycle instead of hanging', () => {
    let c = emptyCircuit()
    c = addPin(c, 'i', 'in', 'input')
    c = addPin(c, 'o', 'out', 'output')
    c = addChip(c, 'x', 'Or')
    c = addChip(c, 'y', 'Not')
    c = connect(c, { pin: 'i' }, { chip: 'x', pin: 'a' })
    c = connect(c, { chip: 'y', pin: 'out' }, { chip: 'x', pin: 'b' }) // feedback
    c = connect(c, { chip: 'x', pin: 'out' }, { chip: 'y', pin: 'in' })
    c = connect(c, { chip: 'x', pin: 'out' }, { pin: 'o' })
    expect(errorsOf(() => simulate(c, { in: 0 }))[0]).toMatch(/Cycle detected.*x.*y/)
  })

  it('lists unconnected input pins', () => {
    let c = emptyCircuit()
    c = addPin(c, 'a', 'a', 'input')
    c = addPin(c, 'o', 'out', 'output')
    c = addChip(c, 'g', 'And')
    c = connect(c, { pin: 'a' }, { chip: 'g', pin: 'a' }) // g.b left open
    c = connect(c, { chip: 'g', pin: 'out' }, { pin: 'o' })
    expect(errorsOf(() => simulate(c, { a: 1 }))).toEqual(['Unconnected input pin: g.b'])
  })

  it('reports an unconnected circuit output pin', () => {
    const c = addPin(emptyCircuit(), 'o', 'out', 'output')
    expect(errorsOf(() => simulate(c, {}))).toEqual(['Unconnected output pin: "out"'])
  })

  it('rejects wires between pins of different widths', () => {
    let c = emptyCircuit()
    c = addPin(c, 'a', 'a', 'input', 16) // 16-bit bus into a 1-bit pin
    c = addPin(c, 'o', 'out', 'output')
    c = addChip(c, 'n', 'Not')
    c = connect(c, { pin: 'a' }, { chip: 'n', pin: 'in' })
    c = connect(c, { chip: 'n', pin: 'out' }, { pin: 'o' })
    expect(errorsOf(() => simulate(c, { a: 0 }))[0]).toMatch(/Width mismatch.*16 bit\(s\) → 1 bit\(s\)/)
  })

  it('rejects two wires driving the same pin', () => {
    let c = emptyCircuit()
    c = addPin(c, 'a', 'a', 'input')
    c = addPin(c, 'b', 'b', 'input')
    c = addPin(c, 'o', 'out', 'output')
    c = addChip(c, 'n', 'Not')
    c = connect(c, { pin: 'a' }, { chip: 'n', pin: 'in' })
    c = connect(c, { pin: 'b' }, { chip: 'n', pin: 'in' })
    c = connect(c, { chip: 'n', pin: 'out' }, { pin: 'o' })
    expect(errorsOf(() => simulate(c, { a: 0, b: 0 }))[0]).toMatch(/more than one wire/)
  })
})
