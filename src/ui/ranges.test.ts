import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { simulate } from '../engine/simulate'
import { edgeWidth, flowToCircuit } from './flowToCircuit'
import { addRanges, compileRanges, normalizeRange, presetRanges, rangeHandleId, removeRange } from './ranges'
import type { AppNode, BusParams, PinRange } from './types'

// ---- tiny graph builders ----------------------------------------------------------------------
const inPin = (id: string, width: number, ranges?: PinRange[]): AppNode =>
  ({ id, type: 'inpin', position: { x: 0, y: 0 }, data: { name: id, width, ...(ranges ? { ranges } : {}) } }) as AppNode
const outPin = (id: string, width: number, ranges?: PinRange[]): AppNode =>
  ({ id, type: 'outpin', position: { x: 0, y: 0 }, data: { name: id, width, ...(ranges ? { ranges } : {}) } }) as AppNode
const chip = (id: string, type: string, params?: BusParams, ranges?: PinRange[]): AppNode =>
  ({ id, type: 'chip', position: { x: 0, y: 0 }, data: { type, ...(params ? { params } : {}), ...(ranges ? { ranges } : {}) } }) as AppNode
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge =>
  ({ id, source, sourceHandle, target, targetHandle })
/** Range list for a pin node: `r('out', [0,7], [8,15])` */
const r = (pin: string, ...bounds: [number, number][]): PinRange[] => bounds.map(([lo, hi]) => ({ pin, lo, hi }))

/** Compile to a circuit, require "no errors", run it. */
function run(nodes: AppNode[], edges: Edge[], inputs: Record<string, number>) {
  const { circuit, errors } = flowToCircuit(nodes, edges)
  expect(errors).toEqual([])
  return simulate(circuit, inputs)
}

describe('range helpers (pure)', () => {
  it('normalizeRange orders the two ends of a drag', () => {
    expect(normalizeRange(5, 2)).toEqual({ lo: 2, hi: 5 })
    expect(normalizeRange(3, 3)).toEqual({ lo: 3, hi: 3 })
  })

  it('rangeHandleId is the pin plus the range, like the label on the board', () => {
    expect(rangeHandleId({ pin: 'a', lo: 4, hi: 7 })).toBe('a[4..7]')
    expect(rangeHandleId({ pin: 'out', lo: 3, hi: 3 })).toBe('out[3]')
  })

  it('presets: bits, nibbles and bytes (the last piece may be shorter)', () => {
    expect(presetRanges(4, 'bits')).toEqual([{ lo: 0, hi: 0 }, { lo: 1, hi: 1 }, { lo: 2, hi: 2 }, { lo: 3, hi: 3 }])
    expect(presetRanges(16, 'nibbles')).toEqual([{ lo: 0, hi: 3 }, { lo: 4, hi: 7 }, { lo: 8, hi: 11 }, { lo: 12, hi: 15 }])
    expect(presetRanges(16, 'bytes')).toEqual([{ lo: 0, hi: 7 }, { lo: 8, hi: 15 }])
    expect(presetRanges(6, 'nibbles')).toEqual([{ lo: 0, hi: 3 }, { lo: 4, hi: 5 }])
    expect(presetRanges(3, 'bytes')).toEqual([{ lo: 0, hi: 2 }])
  })

  it('addRanges skips duplicates and ranges outside the pin, and keeps other pins', () => {
    const start: PinRange[] = [{ pin: 'a', lo: 0, hi: 3 }, { pin: 'b', lo: 0, hi: 3 }]
    const next = addRanges(start, 'a', [{ lo: 0, hi: 3 }, { lo: 4, hi: 7 }, { lo: 8, hi: 20 }], 16)
    expect(next).toEqual([{ pin: 'a', lo: 0, hi: 3 }, { pin: 'b', lo: 0, hi: 3 }, { pin: 'a', lo: 4, hi: 7 }])
    expect(start).toHaveLength(2) // the input is not modified
  })

  it('removeRange removes exactly that range of that pin', () => {
    const list: PinRange[] = [{ pin: 'a', lo: 0, hi: 3 }, { pin: 'b', lo: 0, hi: 3 }, { pin: 'a', lo: 4, hi: 7 }]
    expect(removeRange(list, { pin: 'a', lo: 0, hi: 3 })).toEqual([{ pin: 'b', lo: 0, hi: 3 }, { pin: 'a', lo: 4, hi: 7 }])
  })
})

describe('compileRanges: graphs without ranges are left alone (old saved circuits still load)', () => {
  it('returns the same nodes and edges, no errors', () => {
    const nodes = [inPin('a', 1), chip('n', 'Not'), outPin('o', 1)]
    const edges = [edge('e1', 'a', 'out', 'n', 'in'), edge('e2', 'n', 'out', 'o', 'in')]
    const c = compileRanges(nodes, edges)
    expect(c.nodes).toEqual(nodes)
    expect(c.edges).toEqual(edges)
    expect(c.errors).toEqual([])
    expect(c.issues).toEqual([])
    expect(run(nodes, edges, { a: 1 }).outputs.o).toBe(0)
  })

  it('range handles that no wire uses change nothing', () => {
    const nodes = [inPin('a', 16, r('out', [0, 7])), outPin('o', 16)]
    const edges = [edge('e1', 'a', 'out', 'o', 'in')]
    expect(run(nodes, edges, { a: 0x1234 }).outputs.o).toBe(0x1234)
  })
})

describe('golden tests: ranges give exactly the results of the equivalent Split / Join circuit', () => {
  const samples = [0, 1, 0x8000, 0x00ff, 0xff00, 0x1234, 0xabcd, 0xffff, 0x5a5a, 0x0f0f]

  it('byte swap: in[0..7] -> out[8..15] and in[8..15] -> out[0..7]', () => {
    const withRanges = {
      nodes: [inPin('x', 16, r('out', [0, 7], [8, 15])), outPin('y', 16, r('in', [0, 7], [8, 15]))],
      edges: [edge('e1', 'x', 'out[0..7]', 'y', 'in[8..15]'), edge('e2', 'x', 'out[8..15]', 'y', 'in[0..7]')],
    }
    const withNodes = {
      nodes: [
        inPin('x', 16), outPin('y', 16),
        chip('sp', 'Split', { width: 16, ranges: '0..7, 8..15' }),
        chip('jn', 'Join', { width: 16, ranges: '0..7, 8..15' }),
      ],
      edges: [
        edge('a', 'x', 'out', 'sp', 'in'),
        edge('b', 'sp', '[0..7]', 'jn', '[8..15]'),
        edge('c', 'sp', '[8..15]', 'jn', '[0..7]'),
        edge('d', 'jn', 'out', 'y', 'in'),
      ],
    }
    for (const v of samples) {
      const a = run(withRanges.nodes, withRanges.edges, { x: v }).outputs
      const b = run(withNodes.nodes, withNodes.edges, { x: v }).outputs
      expect(a, `x=${v}`).toEqual(b)
      expect(a.y).toBe(((v & 0xff) << 8) | (v >> 8))
    }
  })

  it('bit reversal with the "to bits" preset on both pins', () => {
    const bits = presetRanges(16, 'bits')
    const nodes = [
      inPin('x', 16, bits.map((b) => ({ pin: 'out', ...b }))),
      outPin('y', 16, bits.map((b) => ({ pin: 'in', ...b }))),
    ]
    const edges = bits.map((b, i) => edge(`e${i}`, 'x', `out[${b.lo}]`, 'y', `in[${15 - b.lo}]`))
    const reverse = (v: number) => parseInt(v.toString(2).padStart(16, '0').split('').reverse().join(''), 2)
    for (const v of samples) expect(run(nodes, edges, { x: v }).outputs.y, `x=${v}`).toBe(reverse(v))
  })

  it('a constant drives one half: out[0..7] <- in[8..15], out[8..15] <- true (8 bits)', () => {
    const nodes = [
      inPin('x', 16, r('out', [8, 15])),
      outPin('y', 16, r('in', [0, 7], [8, 15])),
      chip('k', 'Const', { width: 8, ones: true }),
    ]
    const edges = [edge('e1', 'x', 'out[8..15]', 'y', 'in[0..7]'), edge('e2', 'k', 'out', 'y', 'in[8..15]')]
    for (const v of samples) expect(run(nodes, edges, { x: v }).outputs.y, `x=${v}`).toBe(0xff00 | (v >> 8))
  })

  it('ranges on chip pins: a 4-bit and another 4-bit input drive the two halves of Or8Way.in', () => {
    const nodes = [
      inPin('p', 4), inPin('q', 4), outPin('o', 1),
      chip('or', 'Or8Way', undefined, r('in', [0, 3], [4, 7])),
    ]
    const edges = [edge('e1', 'p', 'out', 'or', 'in[0..3]'), edge('e2', 'q', 'out', 'or', 'in[4..7]'), edge('e3', 'or', 'out', 'o', 'in')]
    for (const [p, q] of [[0, 0], [1, 0], [0, 8], [15, 15]]) {
      expect(run(nodes, edges, { p, q }).outputs.o, `p=${p} q=${q}`).toBe(p | q ? 1 : 0)
    }
  })

  it('Mux4Way16 style: bits of a 2-bit selector (single-bit ranges) feed three Mux16 chips', () => {
    const rangesNodes = [
      inPin('a', 16), inPin('b', 16), inPin('c', 16), inPin('d', 16),
      inPin('sel', 2, r('out', [0, 0], [1, 1])),
      outPin('out', 16),
      chip('m1', 'Mux16'), chip('m2', 'Mux16'), chip('m3', 'Mux16'),
    ]
    const rangesEdges = [
      edge('1', 'a', 'out', 'm1', 'a'), edge('2', 'b', 'out', 'm1', 'b'), edge('3', 'sel', 'out[0]', 'm1', 'sel'),
      edge('4', 'c', 'out', 'm2', 'a'), edge('5', 'd', 'out', 'm2', 'b'), edge('6', 'sel', 'out[0]', 'm2', 'sel'),
      edge('7', 'm1', 'out', 'm3', 'a'), edge('8', 'm2', 'out', 'm3', 'b'), edge('9', 'sel', 'out[1]', 'm3', 'sel'),
      edge('10', 'm3', 'out', 'out', 'in'),
    ]
    const splitNodes = [...rangesNodes.slice(0, 4), inPin('sel', 2), outPin('out', 16), ...rangesNodes.slice(6), chip('sp', 'Split', { width: 2 })]
    const splitEdges = [
      ...rangesEdges.map((e) => (e.sourceHandle === 'out[0]' || e.sourceHandle === 'out[1]'
        ? { ...e, source: 'sp', sourceHandle: e.sourceHandle === 'out[0]' ? '[0]' : '[1]' } : e)),
      edge('s', 'sel', 'out', 'sp', 'in'),
    ]
    for (let sel = 0; sel < 4; sel++) {
      const inp = { a: 0x1111, b: 0x2222, c: 0x3333, d: 0x4444, sel }
      const x = run(rangesNodes, rangesEdges, inp).outputs.out
      expect(x, `sel=${sel}`).toBe(run(splitNodes, splitEdges, inp).outputs.out)
      expect(x).toBe([0x1111, 0x2222, 0x3333, 0x4444][sel])
    }
  })

  it('one wide output pin read as overlapping ranges is allowed (like a Split)', () => {
    const nodes = [inPin('x', 16, r('out', [0, 7], [4, 11])), outPin('lo', 8), outPin('mid', 8)]
    const edges = [edge('e1', 'x', 'out[0..7]', 'lo', 'in'), edge('e2', 'x', 'out[4..11]', 'mid', 'in')]
    const res = run(nodes, edges, { x: 0xabcd })
    expect(res.outputs.lo).toBe(0xcd)
    expect(res.outputs.mid).toBe(0xbc)
  })

  it('the board wire carries the range value: wire ids and widths are those of the ORIGINAL edges', () => {
    const nodes = [inPin('x', 16, r('out', [0, 7], [8, 15])), outPin('y', 16, r('in', [0, 7], [8, 15]))]
    const edges = [edge('e1', 'x', 'out[0..7]', 'y', 'in[8..15]'), edge('e2', 'x', 'out[8..15]', 'y', 'in[0..7]')]
    const { wireValues } = run(nodes, edges, { x: 0x12ab })
    expect(wireValues.e1).toBe(0xab) // carries only bits 0..7
    expect(wireValues.e2).toBe(0x12)
    expect(edgeWidth(nodes, edges[0])).toBe(8) // label width of the ranged wire (not 16)
    expect(edgeWidth(nodes, edge('z', 'x', 'out[3]', 'y', 'in'))).toBe(16) // unknown handle: plain pin width
    const nodes2 = [inPin('x', 16, r('out', [3, 3])), outPin('y', 1)]
    expect(edgeWidth(nodes2, edge('z', 'x', 'out[3]', 'y', 'in'))).toBe(1)
  })

  it('a circuit saved as JSON (localStorage) and loaded again behaves the same', () => {
    const nodes = [inPin('x', 16, r('out', [0, 7], [8, 15])), outPin('y', 16, r('in', [0, 7], [8, 15]))]
    const edges = [edge('e1', 'x', 'out[0..7]', 'y', 'in[8..15]'), edge('e2', 'x', 'out[8..15]', 'y', 'in[0..7]')]
    const loaded = JSON.parse(JSON.stringify({ nodes, edges })) as { nodes: AppNode[]; edges: Edge[] }
    expect(run(loaded.nodes, loaded.edges, { x: 0x1234 }).outputs.y).toBe(0x3412)
  })
})

describe('validation with clear messages (shown on the pin and in the Run error)', () => {
  it('width mismatch: the other side must have the width of the range', () => {
    const nodes = [inPin('x', 16, r('out', [4, 7])), outPin('y', 8)]
    const edges = [edge('e1', 'x', 'out[4..7]', 'y', 'in')]
    const c = compileRanges(nodes, edges)
    expect(c.errors).toHaveLength(1)
    expect(c.errors[0]).toMatch(/Width mismatch.*x\[4\.\.7\].*4 bit.*y.*8 bit/)
    expect(c.issues.map((i) => i.nodeId).sort()).toEqual(['x', 'y']) // both pins get a message
    expect(flowToCircuit(nodes, edges).errors[0]).toMatch(/Width mismatch/) // and Run shows it
  })

  it('a range wired to a range of another width is reported too', () => {
    const nodes = [inPin('x', 16, r('out', [0, 7])), outPin('y', 16, r('in', [0, 3]))]
    const edges = [edge('e1', 'x', 'out[0..7]', 'y', 'in[0..3]')]
    expect(compileRanges(nodes, edges).errors[0]).toMatch(/8 bit.*4 bit/)
  })

  it('several ranges driving one wide pin: overlapping bits are listed', () => {
    const nodes = [inPin('a', 8), inPin('b', 8), outPin('y', 12, r('in', [0, 7], [4, 11]))]
    const edges = [edge('e1', 'a', 'out', 'y', 'in[0..7]'), edge('e2', 'b', 'out', 'y', 'in[4..11]')]
    const c = compileRanges(nodes, edges)
    expect(c.errors.some((m) => /overlap/.test(m) && /bits 4\.\.7/.test(m))).toBe(true)
    expect(c.issues.some((i) => i.nodeId === 'y' && /overlap/.test(i.message))).toBe(true)
  })

  it('bits that no wire drives are listed (like an incomplete Join)', () => {
    const nodes = [inPin('a', 8), outPin('y', 16, r('in', [0, 7], [8, 15]))]
    const edges = [edge('e1', 'a', 'out', 'y', 'in[0..7]')] // the high byte has a handle but no wire
    const c = compileRanges(nodes, edges)
    expect(c.errors).toHaveLength(1)
    expect(c.errors[0]).toMatch(/y.*bits 8\.\.15 are not driven/)
    const gaps = compileRanges(
      [inPin('a', 4), inPin('b', 4), outPin('y', 16, r('in', [0, 3], [8, 11]))],
      [edge('1', 'a', 'out', 'y', 'in[0..3]'), edge('2', 'b', 'out', 'y', 'in[8..11]')],
    )
    expect(gaps.errors[0]).toMatch(/bits 4\.\.7, 12\.\.15 are not driven/)
  })

  it('driving a pin both as a whole and through a range is a conflict', () => {
    const nodes = [inPin('a', 16), inPin('b', 8), outPin('y', 16, r('in', [0, 7]))]
    const edges = [edge('e1', 'a', 'out', 'y', 'in'), edge('e2', 'b', 'out', 'y', 'in[0..7]')]
    expect(compileRanges(nodes, edges).errors.some((m) => /whole.*range|range.*whole/i.test(m))).toBe(true)
  })

  it('a range outside the pin is an error', () => {
    const nodes = [inPin('a', 8, r('out', [4, 20])), outPin('y', 17)]
    const c = compileRanges(nodes, [edge('e1', 'a', 'out[4..20]', 'y', 'in')])
    expect(c.errors.some((m) => /outside/.test(m))).toBe(true)
  })

  it('on an error no half-compiled graph is produced (wires through range handles are dropped)', () => {
    const nodes = [inPin('x', 16, r('out', [4, 7])), outPin('y', 8)]
    const c = compileRanges(nodes, [edge('e1', 'x', 'out[4..7]', 'y', 'in')])
    expect(c.edges).toEqual([])
    expect(c.nodes).toHaveLength(2) // no synthetic Split / Join nodes
    // flowToCircuit therefore reports the range error and nothing about "invalid wires"
    const { errors } = flowToCircuit(nodes, [edge('e1', 'x', 'out[4..7]', 'y', 'in')])
    expect(errors.some((m) => /Invalid wire/.test(m))).toBe(false)
  })

  it('a fully valid graph has no issues for the pins', () => {
    const nodes = [inPin('x', 16, r('out', [0, 7], [8, 15])), outPin('y', 16, r('in', [0, 7], [8, 15]))]
    const edges = [edge('e1', 'x', 'out[0..7]', 'y', 'in[8..15]'), edge('e2', 'x', 'out[8..15]', 'y', 'in[0..7]')]
    expect(compileRanges(nodes, edges).issues).toEqual([])
  })
})
