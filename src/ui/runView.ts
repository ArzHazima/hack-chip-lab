// Turns engine results into the shape the results table shows.

import type { ExerciseRun } from '../engine/exercise'
import type { TestRun } from '../engine/runTests'
import type { RunView } from './types'

/** Combinational .cmp run (no .tst): `widths` maps column name -> bit width for binary output. */
export function fromTestRun(run: TestRun, widths: Record<string, number>): RunView {
  const fmt = (vals: Record<string, number>) =>
    Object.entries(vals)
      .map(([k, v]) => `${k}=${v.toString(2).padStart(widths[k] ?? 1, '0')}`)
      .join('  ')
  return {
    ok: run.passed === run.total,
    passed: run.passed,
    total: run.total,
    headers: ['Inputs', 'Expected', 'Actual'],
    rows: run.rows.map((r) => ({
      index: r.index,
      pass: r.pass,
      cells: [fmt(r.inputs), fmt(r.expected), fmt(r.actual)],
      snap: { inputs: r.inputs, outputs: r.actual, wireValues: r.wireValues },
    })),
  }
}

/** .tst + .cmp run: rows are the text lines the script's `output` commands produced. */
export function fromExercise(run: ExerciseRun): RunView {
  return {
    ok: run.passed === run.total && !run.message,
    passed: run.passed,
    total: run.total,
    headers: ['Expected (.cmp)', 'Actual'],
    note: [`Columns: ${run.columns.join(' | ')}`, run.message].filter(Boolean).join(' — '),
    info: run.info,
    rows: run.rows.map((r) => ({ index: r.index, pass: r.pass, cells: [r.expected, r.actual] })),
    replay: (index) => {
      try {
        return run.replay(index)
      } catch {
        return undefined // the same script ran fine a moment ago; if it does not now, just show no colours
      }
    },
  }
}
