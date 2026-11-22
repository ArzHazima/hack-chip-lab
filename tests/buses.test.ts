// End-to-end tests with INVENTED chips (tests/fixtures/buses/*). Nothing here depends on any
// real course exercise. The pipeline is the same one the app uses when you pick a chip:
//   folder files → groupExerciseFiles → parseHdlInterface → pins on the board
//   → (the "user" wires chips: React Flow nodes + edges) → flowToCircuit → runExercise.

import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { groupExerciseFiles, runExercise, type ExerciseChip } from '../src/engine/exercise'
import { parseHdlInterface } from '../src/engine/hdl'
import { CircuitError } from '../src/engine/simulate'
import { pinsFromInterface } from '../src/ui/exercisePins'
import { flowToCircuit } from '../src/ui/flowToCircuit'
import type { AppNode, BusParams } from '../src/ui/types'

// ---- "load the folder": every file under fixtures/buses, as the file picker would give them ----
const raw = import.meta.glob('./fixtures/buses/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const folder = (): ExerciseChip[] =>
  groupExerciseFiles(Object.entries(raw).map(([path, text]) => ({ name: path, text })))

// ---- a tiny board builder: what the user does with the mouse, as data ----
class Board {
  nodes: AppNode[]
  edges: Edge[] = []
  constructor(chip: ExerciseChip) {
    let n = 1
    this.nodes = pinsFromInterface(parseHdlInterface(chip.hdl!.text), () => n++) // auto-created pins
  }
  pin(name: string): string {
    const node = this.nodes.find((x) => x.type !== 'chip' && x.data.name === name)
    if (!node) throw new Error(`no pin ${name}`)
    return node.id
  }
  chip(id: string, type: string, params?: BusParams): string {
    this.nodes.push({ id, type: 'chip', position: { x: 0, y: 0 }, data: params ? { type, params } : { type } })
    return id
  }
  /** Wire source.handle → target.handle (pins use handle 'out' as source and 'in' as target). */
  wire(source: string, sourceHandle: string, target: string, targetHandle: string): void {
    this.edges.push({ id: `e${this.edges.length + 1}`, source, sourceHandle, target, targetHandle })
  }
  run(chip: ExerciseChip) {
    const { circuit, errors } = flowToCircuit(this.nodes, this.edges)
    expect(errors).toEqual([])
    return runExercise(circuit, chip.tst!.text, chip.cmp!.text)
  }
}

const find = (name: string): ExerciseChip => {
  const c = folder().find((x) => x.name === name)
  if (!c) throw new Error(`fixture ${name} not found`)
  return c
}

// ---- the three chips, built the way a student would ----

/** And16 from sixteen And chips: Split both inputs into bits, And each pair, Join. */
function buildWide16And(chip: ExerciseChip, board = new Board(chip)): Board {
  const sa = board.chip('splitA', 'Split', { width: 16 })
  const sb = board.chip('splitB', 'Split', { width: 16 })
  const jn = board.chip('join', 'Join', { width: 16 })
  board.wire(board.pin('a'), 'out', sa, 'in')
  board.wire(board.pin('b'), 'out', sb, 'in')
  for (let i = 0; i < 16; i++) {
    const g = board.chip(`and${i}`, 'And')
    board.wire(sa, `[${i}]`, g, 'a')
    board.wire(sb, `[${i}]`, g, 'b')
    board.wire(g, 'out', jn, `[${i}]`)
  }
  board.wire(jn, 'out', board.pin('out'), 'in')
  return board
}

/** Mux4Way16 from three Mux16: sel[0] picks within each pair, sel[1] picks the pair. */
function buildPick4of16(chip: ExerciseChip): Board {
  const board = new Board(chip)
  const sp = board.chip('splitSel', 'Split', { width: 2 })
  const ab = board.chip('muxAB', 'Mux16')
  const cd = board.chip('muxCD', 'Mux16')
  const fin = board.chip('muxFinal', 'Mux16')
  board.wire(board.pin('sel'), 'out', sp, 'in')
  board.wire(board.pin('a'), 'out', ab, 'a')
  board.wire(board.pin('b'), 'out', ab, 'b')
  board.wire(board.pin('c'), 'out', cd, 'a')
  board.wire(board.pin('d'), 'out', cd, 'b')
  board.wire(sp, '[0]', ab, 'sel')
  board.wire(sp, '[0]', cd, 'sel')
  board.wire(ab, 'out', fin, 'a')
  board.wire(cd, 'out', fin, 'b')
  board.wire(sp, '[1]', fin, 'sel')
  board.wire(fin, 'out', board.pin('out'), 'in')
  return board
}

/** Bit reversal: Split into single bits, Join them in the opposite order. */
function buildMirror16(chip: ExerciseChip, reversed = true): Board {
  const board = new Board(chip)
  const sp = board.chip('split', 'Split', { width: 16 })
  const jn = board.chip('join', 'Join', { width: 16 })
  board.wire(board.pin('in'), 'out', sp, 'in')
  for (let i = 0; i < 16; i++) board.wire(sp, `[${i}]`, jn, `[${reversed ? 15 - i : i}]`)
  board.wire(jn, 'out', board.pin('out'), 'in')
  return board
}

describe('invented chips that use Split / Join / Const', () => {
  it('And16 built from 16 And chips with Split and Join passes its .tst/.cmp', () => {
    const chip = find('Wide16And')
    const run = buildWide16And(chip).run(chip)
    expect(run.rows.filter((r) => !r.pass)).toEqual([])
    expect(run.total).toBe(4)
    expect(run.passed).toBe(4)
  })

  it('Mux4Way16 built from Mux16 chips (selector split into bits) passes', () => {
    const chip = find('Pick4of16')
    const run = buildPick4of16(chip).run(chip)
    expect(run.rows.filter((r) => !r.pass)).toEqual([])
    expect(run.passed).toBe(5)
  })

  it('a bit-reversal chip passes, and the identity wiring is caught as wrong', () => {
    const chip = find('Mirror16')
    const good = buildMirror16(chip).run(chip)
    expect(good.rows.filter((r) => !r.pass)).toEqual([])
    expect(good.passed).toBe(7)

    const bad = buildMirror16(chip, false).run(chip) // forgot to reverse
    expect(bad.passed).toBeLessThan(bad.total)
    expect(bad.rows[0].expected).not.toBe(bad.rows[0].actual) // bit 0 stayed at bit 0
    // the symmetric rows (0x8001, 0xFFFF, 0) still pass: only the asymmetric ones fail
    expect(bad.rows.map((r) => r.pass)).toEqual([false, false, false, false, true, true, true])
  })

  it('a folder with 3 invented chips, loaded through the selector flow end to end', () => {
    const chips = folder()
    expect(chips.map((c) => c.name)).toEqual(['Mirror16', 'Pick4of16', 'Wide16And'])
    expect(chips.every((c) => c.missing.length === 0)).toBe(true)

    // Picking a chip creates exactly the pins its .hdl declares (names + widths), for ANY chip.
    const pinsOf = (name: string) => {
      const c = find(name)
      return pinsFromInterface(parseHdlInterface(c.hdl!.text), (() => { let i = 1; return () => i++ })())
        .map((n) => (n.type === 'chip' ? '' : `${n.type}:${n.data.name}[${n.data.width}]`))
    }
    expect(pinsOf('Mirror16')).toEqual(['inpin:in[16]', 'outpin:out[16]'])
    expect(pinsOf('Pick4of16')).toEqual([
      'inpin:a[16]', 'inpin:b[16]', 'inpin:c[16]', 'inpin:d[16]', 'inpin:sel[2]', 'outpin:out[16]',
    ])
    expect(pinsOf('Wide16And')).toEqual(['inpin:a[16]', 'inpin:b[16]', 'outpin:out[16]'])

    const builders: Record<string, (c: ExerciseChip) => Board> = {
      Mirror16: buildMirror16, Pick4of16: buildPick4of16, Wide16And: buildWide16And,
    }
    for (const chip of chips) {
      const run = builders[chip.name](chip).run(chip)
      expect({ chip: chip.name, passed: run.passed, total: run.total }).toEqual({ chip: chip.name, passed: run.total, total: run.total })
      expect(run.warnings).toEqual([])
    }
  })

  it('a missing .cmp file is listed, not hidden', () => {
    const files = Object.entries(raw)
      .filter(([p]) => !p.endsWith('Mirror16.cmp'))
      .map(([path, text]) => ({ name: path, text }))
    const mirror = groupExerciseFiles(files).find((c) => c.name === 'Mirror16')!
    expect(mirror.missing).toEqual(['cmp'])
  })

  it('mistakes in the wiring give clear errors instead of wrong answers', () => {
    const chip = find('Mirror16')

    // 1. one bit left out: Join has an unconnected input
    const missing = buildMirror16(chip)
    missing.edges.pop() // drop join.out -> out
    missing.edges.splice(5, 1) // and one bit wire
    const a = flowToCircuit(missing.nodes, missing.edges)
    expect(() => runExercise(a.circuit, chip.tst!.text, chip.cmp!.text)).toThrow(CircuitError)

    // 2. bad ranges text on a Join is reported by name
    const board = new Board(chip)
    board.chip('jn', 'Join', { width: 16, ranges: '0..7, 4..11' })
    expect(flowToCircuit(board.nodes, []).errors).toEqual([])
    const overlap = flowToCircuit(board.nodes, []).circuit
    expect(() => runExercise(overlap, chip.tst!.text, chip.cmp!.text)).toThrow(/overlap/)

    const syntax = new Board(chip)
    syntax.chip('sp', 'Split', { width: 16, ranges: '0..x' })
    expect(flowToCircuit(syntax.nodes, []).errors[0]).toMatch(/Split sp: Bad range "0..x"/)
  })
})
