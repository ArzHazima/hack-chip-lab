// The three invented fixture chips again, but wired ONLY with bit-range handles on the pins
// (no Split / Join nodes): same pipeline as picking a chip in the app.

import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { groupExerciseFiles, runExercise, type ExerciseChip } from '../src/engine/exercise'
import { parseHdlInterface } from '../src/engine/hdl'
import { pinsFromInterface } from '../src/ui/exercisePins'
import { flowToCircuit } from '../src/ui/flowToCircuit'
import { presetRanges } from '../src/ui/ranges'
import type { AppNode, PinRange } from '../src/ui/types'

const raw = import.meta.glob('./fixtures/buses/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const find = (name: string): ExerciseChip => {
  const c = groupExerciseFiles(Object.entries(raw).map(([path, text]) => ({ name: path, text }))).find((x) => x.name === name)
  if (!c) throw new Error(`fixture ${name} not found`)
  return c
}

/** A board for one chip: the pins come from its .hdl, ranges are added to them. */
class Board {
  nodes: AppNode[]
  edges: Edge[] = []
  constructor(chip: ExerciseChip) {
    let n = 1
    this.nodes = pinsFromInterface(parseHdlInterface(chip.hdl!.text), () => n++)
  }
  pinNode(name: string): AppNode {
    const node = this.nodes.find((x) => x.type !== 'chip' && x.data.name === name)
    if (!node) throw new Error(`no pin ${name}`)
    return node
  }
  /** Give a pin node range handles. Input pin nodes send wires from 'out', output pin nodes receive on 'in'. */
  ranges(name: string, list: { lo: number; hi: number }[]): void {
    const node = this.pinNode(name)
    const pin = node.type === 'inpin' ? 'out' : 'in'
    const ranges: PinRange[] = list.map((r) => ({ pin, ...r }))
    ;(node.data as { ranges?: PinRange[] }).ranges = ranges
  }
  chip(id: string, type: string): string {
    this.nodes.push({ id, type: 'chip', position: { x: 0, y: 0 }, data: { type } })
    return id
  }
  wire(source: string, sourceHandle: string, target: string, targetHandle: string): void {
    this.edges.push({ id: `e${this.edges.length + 1}`, source, sourceHandle, target, targetHandle })
  }
  run(chip: ExerciseChip) {
    const { circuit, errors } = flowToCircuit(this.nodes, this.edges)
    expect(errors).toEqual([])
    return runExercise(circuit, chip.tst!.text, chip.cmp!.text)
  }
}

describe('fixture chips wired only with bit ranges on the pins', () => {
  it('Mirror16: "Split to bits" on in and out, in[i] -> out[15-i]', () => {
    const chip = find('Mirror16')
    const b = new Board(chip)
    const bits = presetRanges(16, 'bits')
    b.ranges('in', bits)
    b.ranges('out', bits)
    for (let i = 0; i < 16; i++) b.wire(b.pinNode('in').id, `out[${i}]`, b.pinNode('out').id, `in[${15 - i}]`)
    const run = b.run(chip)
    expect(run.rows.filter((r) => !r.pass)).toEqual([])
    expect(run.passed).toBe(7)
  })

  it('Pick4of16: the two bits of sel are ranges of the input pin, three Mux16 chips do the rest', () => {
    const chip = find('Pick4of16')
    const b = new Board(chip)
    b.ranges('sel', [{ lo: 0, hi: 0 }, { lo: 1, hi: 1 }])
    const sel = b.pinNode('sel').id
    const ab = b.chip('muxAB', 'Mux16')
    const cd = b.chip('muxCD', 'Mux16')
    const fin = b.chip('muxFinal', 'Mux16')
    b.wire(b.pinNode('a').id, 'out', ab, 'a')
    b.wire(b.pinNode('b').id, 'out', ab, 'b')
    b.wire(b.pinNode('c').id, 'out', cd, 'a')
    b.wire(b.pinNode('d').id, 'out', cd, 'b')
    b.wire(sel, 'out[0]', ab, 'sel')
    b.wire(sel, 'out[0]', cd, 'sel')
    b.wire(ab, 'out', fin, 'a')
    b.wire(cd, 'out', fin, 'b')
    b.wire(sel, 'out[1]', fin, 'sel')
    b.wire(fin, 'out', b.pinNode('out').id, 'in')
    const run = b.run(chip)
    expect(run.rows.filter((r) => !r.pass)).toEqual([])
    expect(run.passed).toBe(5)
  })

  it('Wide16And: a[i] and b[i] go through 16 And chips into out[i]', () => {
    const chip = find('Wide16And')
    const b = new Board(chip)
    const bits = presetRanges(16, 'bits')
    b.ranges('a', bits)
    b.ranges('b', bits)
    b.ranges('out', bits)
    for (let i = 0; i < 16; i++) {
      const g = b.chip(`and${i}`, 'And')
      b.wire(b.pinNode('a').id, `out[${i}]`, g, 'a')
      b.wire(b.pinNode('b').id, `out[${i}]`, g, 'b')
      b.wire(g, 'out', b.pinNode('out').id, `in[${i}]`)
    }
    const run = b.run(chip)
    expect(run.rows.filter((r) => !r.pass)).toEqual([])
    expect(run.passed).toBe(4)
  })

  it('a wrong wiring is caught by the test, a malformed one by a clear range error', () => {
    const chip = find('Mirror16')
    const b = new Board(chip)
    const bytes = presetRanges(16, 'bytes')
    b.ranges('in', bytes)
    b.ranges('out', bytes)
    // swapping the bytes is NOT a bit reversal: runs fine, but fails rows
    b.wire(b.pinNode('in').id, 'out[0..7]', b.pinNode('out').id, 'in[8..15]')
    b.wire(b.pinNode('in').id, 'out[8..15]', b.pinNode('out').id, 'in[0..7]')
    const run = b.run(chip)
    expect(run.passed).toBeLessThan(run.total)

    // forgetting the high byte is reported as undriven bits, not as a wrong answer
    b.edges.pop()
    const { errors } = flowToCircuit(b.nodes, b.edges)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/out.*bits 0\.\.7 are not driven/)
  })
})
