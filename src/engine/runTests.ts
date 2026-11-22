// Run every row of a parsed .cmp against a circuit.

import type { CmpFile } from './cmp'
import type { Circuit } from './circuit'
import { CircuitError, evaluate, orderChips, validateCircuit } from './simulate'

export interface RowResult {
  index: number // 0-based row index
  inputs: Record<string, number>
  expected: Record<string, number>
  actual: Record<string, number>
  pass: boolean
  failedOutputs: string[] // names of output columns that differ
  wireValues: Record<string, number> // for coloring the canvas when the row is clicked
}

export interface TestRun {
  rows: RowResult[]
  passed: number
  total: number
}

/**
 * Columns whose name matches a circuit input pin are inputs; the rest are expected
 * outputs. Throws CircuitError for setup problems (bad circuit, unknown/mis-sized columns).
 */
export function runTests(circuit: Circuit, cmp: CmpFile): TestRun {
  const errors = validateCircuit(circuit)
  const inPins = circuit.pins.filter((p) => p.kind === 'input')
  const outPins = circuit.pins.filter((p) => p.kind === 'output')

  cmp.columns.forEach((name, i) => {
    const pin = [...inPins, ...outPins].find((p) => p.name === name)
    if (!pin) errors.push(`Column "${name}" in .cmp matches no circuit pin`)
    else if (pin.width !== cmp.widths[i]) {
      errors.push(`Column "${name}" is ${cmp.widths[i]} bit(s) in .cmp but pin is ${pin.width}`)
    }
  })
  for (const p of [...inPins, ...outPins]) {
    if (!cmp.columns.includes(p.name)) errors.push(`.cmp has no column for pin "${p.name}"`)
  }
  if (errors.length) throw new CircuitError(errors)

  // Plan ONCE. (Validating and planning inside the row loop made a run cost O(rows x wires x chips).)
  const order = orderChips(circuit)

  const isInput = (name: string) => inPins.some((p) => p.name === name)
  const rows = cmp.rows.map((row, index): RowResult => {
    const inputs: Record<string, number> = {}
    const expected: Record<string, number> = {}
    cmp.columns.forEach((name, i) => {
      ;(isInput(name) ? inputs : expected)[name] = row.values[i]
    })
    // Fresh state per row: rows of a combinational table are independent of each other.
    const { outputs: actual, wireValues } = evaluate(circuit, order, inputs, new Map())
    const failedOutputs = Object.keys(expected).filter((n) => actual[n] !== expected[n])
    return { index, inputs, expected, actual, pass: failedOutputs.length === 0, failedOutputs, wireValues }
  })
  return { rows, passed: rows.filter((r) => r.pass).length, total: rows.length }
}
