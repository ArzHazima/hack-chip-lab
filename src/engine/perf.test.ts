// Regression tests for the cost of running a .cmp: the circuit must be validated and planned
// ONCE, not once per row. Timing tests are loose on purpose (relative to evaluate() itself,
// plus a generous absolute limit) so they do not fail on a slow machine, but they fail clearly
// if the per-row validation ever comes back.

import { describe, expect, it } from 'vitest'
import type { CmpFile } from './cmp'
import { addChip, addPin, connect, emptyCircuit, type Circuit, type Endpoint } from './circuit'
import { runTests } from './runTests'
import { evaluate, planOrder, simulate, validateCircuit } from './simulate'

/** in -> Not16 -> Not16 -> ... -> out (n chips, n+1 wires). */
function chain(n: number): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'in', 'in', 'input', 16)
  c = addPin(c, 'out', 'out', 'output', 16)
  let prev: Endpoint = { pin: 'in' }
  for (let i = 0; i < n; i++) {
    c = addChip(c, `n${i}`, 'Not16')
    c = connect(c, prev, { chip: `n${i}`, pin: 'in' })
    prev = { chip: `n${i}`, pin: 'out' }
  }
  return connect(c, prev, { pin: 'out' })
}

/** A .cmp for the chain: out = in for an even chain length, ~in for an odd one. */
function cmpFor(n: number, rows: number): CmpFile {
  const values = Array.from({ length: rows }, (_, i) => {
    const x = (i * 2654435761) & 0xffff
    return { values: [x, n % 2 === 0 ? x : ~x & 0xffff] }
  })
  return { columns: ['in', 'out'], widths: [16, 16], rows: values }
}

const ms = (fn: () => void): number => {
  const t = performance.now()
  fn()
  return performance.now() - t
}
const best = (fn: () => void, runs = 3): number => Math.min(...Array.from({ length: runs }, () => ms(fn)))

describe('cost of running many .cmp rows', () => {
  it('runTests on a 200-chip chain with 1000 rows is not much slower than evaluate() alone', () => {
    const c = chain(200)
    const cmp = cmpFor(200, 1000)
    const order = planOrder(c)
    const evalOnly = () => {
      for (const row of cmp.rows) evaluate(c, order, { in: row.values[0] }, new Map())
    }
    evalOnly() // warm up the JIT
    runTests(c, cmp)

    const tEval = best(evalOnly)
    const tRun = best(() => {
      const run = runTests(c, cmp)
      expect(run.passed).toBe(1000)
    })
    // Before the fix every row also re-validated and re-planned (about 3x the evaluate() time).
    expect(tRun).toBeLessThan(tEval * 1.8 + 50)
    expect(tRun).toBeLessThan(1000) // "a reasonable time" in absolute terms
  })

  it('validateCircuit on a 1000-chip circuit is cheap (lookups by id, not by scanning)', () => {
    const c = chain(1000)
    validateCircuit(c) // warm up
    const t = best(() => {
      for (let i = 0; i < 20; i++) expect(validateCircuit(c)).toEqual([])
    })
    // Scanning arrays for every wire cost about 9 ms per call here (~180 ms for 20 calls).
    expect(t).toBeLessThan(120)
  })

  it('simulate() still validates (a bad circuit is reported, not evaluated)', () => {
    const c = chain(3)
    c.wires.pop() // output pin no longer driven
    expect(() => simulate(c, { in: 1 })).toThrow(/Unconnected output pin/)
  })
})
