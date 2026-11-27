// Memory of a LONG script (stage 3, item 10): 30,000 output rows on a circuit with ~100 wires.
// Before lazy replay every row kept a copy of all wire values (about 6.5 KB per row). Now a row is two short strings
// and a flag; the wire values of a clicked row are rebuilt by replaying the script.
// The size is ESTIMATED by walking the result (no garbage collector flags, no heap measurement): that is exact enough to
// tell ~0.2 KB per row from ~6.5 KB per row, and it cannot flake on a busy machine.
import { describe, expect, it } from 'vitest'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from '../src/engine/circuit'
import { runExercise } from '../src/engine/exercise'
import { parseTst, runTst } from '../src/engine/tst'

/** Rough retained bytes of a value: 2 bytes per string character + 16 header, 8 per number, 32 per object + 8 per key. */
function sizeOf(root: unknown): number {
  const seen = new Set<object>()
  const walk = (v: unknown): number => {
    if (typeof v === 'string') return 16 + 2 * v.length
    if (typeof v === 'number') return 8
    if (typeof v === 'boolean' || v == null) return 4
    if (typeof v !== 'object' || seen.has(v)) return 0 // functions (the replay closure) are not counted
    seen.add(v)
    let n = 32
    for (const [k, x] of Object.entries(v)) n += 8 + 2 * k.length + walk(x)
    return n
  }
  return walk(root)
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
repeat 15000 { tick, output; tock, output; }`

describe('memory of a long script', () => {
  it('30,000 rows stay small (the "before" design kept ~6.5 KB per row), and a clicked row is replayed', () => {
    const circuit = chain()
    // The .cmp is this circuit's own output, so every row passes; only the size of the result is measured.
    const cmpText = ['| header |', ...runTst(circuit, parseTst(TST)).rows].join('\n')
    const run = runExercise(circuit, TST, cmpText)
    expect(run.rows.length).toBe(30000)
    expect(run.passed).toBe(30000)

    // A row holds exactly its four fields: no wire map, no snapshot.
    expect(Object.keys(run.rows[0]).sort()).toEqual(['actual', 'expected', 'index', 'pass'])
    const perRow = sizeOf(run.rows) / run.rows.length
    // eslint-disable-next-line no-console
    console.log(`MEASURE rows=${run.rows.length} about ${perRow.toFixed(0)} B/row`)
    expect(perRow).toBeLessThan(600) // measured ~250; the old per-row wire values were ~6,500 bytes each

    // Lazy replay: the last row is rebuilt on demand. Only one wire map exists, and it is correct.
    const snap = run.replay(29999)!
    expect(Object.keys(snap.wireValues).length).toBeGreaterThan(100)
    expect(snap.time).toBe('15000')
    expect(snap.inputs.in).toBe(12345)
    // 100 inversions give the input back, 16 bits wide: the register holds 12345 after the first tock.
    expect(snap.outputs.out).toBe(12345)
  }, 60_000)
})
