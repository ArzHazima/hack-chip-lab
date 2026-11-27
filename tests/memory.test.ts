// Memory of a LONG script (stage 3, item 10): 100,000 output rows on a circuit with ~100 wires.
// Before lazy replay every row kept a copy of all wire values (about 6.5 KB per row, ~620 MB in total).
// Now a row is two short strings and a flag; the wire values of a clicked row are rebuilt by replaying the script.
import { describe, expect, it } from 'vitest'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from '../src/engine/circuit'
import { runExercise } from '../src/engine/exercise'
import { parseTst, runTst } from '../src/engine/tst'

// This project has no Node typings, so Node's own modules are loaded dynamically (only this test needs them).
const nodeModule = async (name: string): Promise<any> => import(/* @vite-ignore */ name) // eslint-disable-line @typescript-eslint/no-explicit-any
const v8 = await nodeModule('node:v8')
const vm = await nodeModule('node:vm')
// `gc` only exists with a flag; this switches it on at run time so the numbers are real retained bytes.
v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void
const heap = (): number => {
  gc()
  gc()
  return (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process.memoryUsage().heapUsed
}

/** in[16] -> 100 x Not16 -> Register(load) -> out[16]: about 105 wires, one clocked chip. */
function chain(n = 100): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'pin', 'in', 'input', 16)
  c = addPin(c, 'pload', 'load', 'input', 1)
  c = addPin(c, 'pout', 'out', 'output', 16)
  let prev: { pin: string } | { chip: string; pin: string } = { pin: 'pin' }
  for (let i = 0; i < n; i++) {
    c = addChip(c, `n${i}`, 'Not16')
    c = connect(c, prev, { chip: `n${i}`, pin: 'in' })
    prev = { chip: `n${i}`, pin: 'out' }
  }
  c = addChip(c, 'r', 'Register')
  c = connect(c, prev, { chip: 'r', pin: 'in' })
  c = connect(c, { pin: 'pload' }, { chip: 'r', pin: 'load' })
  c = connect(c, { chip: 'r', pin: 'out' }, { pin: 'pout' })
  return c
}

const TST = `output-list time%S1.4.1 in%D1.6.1 load%B2.1.2 out%D1.6.1;
set in 12345, set load 1,
repeat 50000 { tick, output; tock, output; }`

describe('memory of a long script', () => {
  it('100,000 rows stay small (the "before" figure was 618.6 MB), and a clicked row is replayed', () => {
    const circuit = chain()
    // The .cmp is this circuit's own output, so every row passes; only the size of the result is measured.
    const cmpText = ['| header |', ...runTst(circuit, parseTst(TST)).rows].join('\n')
    const before = heap()
    let run: ReturnType<typeof runExercise> | undefined = runExercise(circuit, TST, cmpText)
    const after = heap()
    const mb = (after - before) / 1024 / 1024
    // eslint-disable-next-line no-console
    console.log(`MEASURE rows=${run.rows.length} retained=${mb.toFixed(1)} MB (${((after - before) / run.rows.length).toFixed(0)} B/row)`)
    expect(run.rows.length).toBe(100000)
    expect(run.passed).toBe(100000)
    expect(mb).toBeLessThan(60) // measured: see the console line; the old design kept ~620 MB here

    // Lazy replay: row 99,999 is rebuilt on demand. Only one wire map exists, and it is correct.
    const snap = run.replay(99999)!
    expect(Object.keys(snap.wireValues).length).toBeGreaterThan(100)
    expect(snap.time).toBe('50000')
    expect(snap.inputs.in).toBe(12345)
    // 100 inversions give the input back, 16 bits wide: the register holds 12345 after the first tock.
    expect(snap.outputs.out).toBe(12345)
    run = undefined
  }, 120_000)
})
