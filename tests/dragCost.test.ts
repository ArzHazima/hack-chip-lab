// M6: what does dragging ONE node cost on a board of about 150 nodes?
// While a node is dragged React Flow reports a new `nodes` array on every mouse move (only `position` changes).
// App recomputes things from `nodes` on each move; this test times those pieces and guards the memoised path.

import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { Simulator } from '../src/engine/sequential'
import { compileRanges } from '../src/ui/ranges'
import { structureKey } from '../src/ui/structureKey'
import { edgeWidth, flowToCircuit, inputValues } from '../src/ui/flowToCircuit'
import type { AppNode } from '../src/ui/types'

/** 8 input pins, 136 Nand gates in a grid (each fed by two earlier nodes), 6 output pins: 150 nodes. */
function bigBoard(): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = []
  const edges: Edge[] = []
  const pool: string[] = []
  for (let i = 0; i < 8; i++) {
    nodes.push({ id: `inpin${i}`, type: 'inpin', position: { x: 0, y: i * 60 }, data: { name: `i${i}`, width: 1, inputValue: i & 1 } })
    pool.push(`inpin${i}`)
  }
  for (let g = 0; g < 136; g++) {
    const id = `Nand${g}`
    nodes.push({ id, type: 'chip', position: { x: 200 + (g % 17) * 150, y: Math.floor(g / 17) * 80 }, data: { type: 'Nand' } })
    const a = pool[g % pool.length]
    const b = pool[(g * 7 + 3) % pool.length]
    const out = (n: string) => (n.startsWith('inpin') ? 'out' : 'out')
    edges.push({ id: `ea${g}`, source: a, sourceHandle: out(a), target: id, targetHandle: 'a' })
    edges.push({ id: `eb${g}`, source: b, sourceHandle: out(b), target: id, targetHandle: 'b' })
    pool.push(id)
  }
  for (let o = 0; o < 6; o++) {
    const id = `outpin${o}`
    nodes.push({ id, type: 'outpin', position: { x: 3000, y: o * 60 }, data: { name: `o${o}`, width: 1 } })
    edges.push({ id: `eo${o}`, source: pool[pool.length - 1 - o], sourceHandle: 'out', target: id, targetHandle: 'in' })
  }
  return { nodes, edges }
}

const time = (n: number, f: () => void) => {
  f() // warm up
  const t = performance.now()
  for (let i = 0; i < n; i++) f()
  return (performance.now() - t) / n
}

describe('dragging a node on a 150-node board (M6)', () => {
  const { nodes, edges } = bigBoard()
  it('the board is wired correctly', () => {
    expect(nodes.length).toBe(150)
    const { errors } = flowToCircuit(nodes, edges)
    expect(errors).toEqual([])
  })

  it('reports the cost per mouse move of each recomputation', () => {
    const { circuit } = flowToCircuit(nodes, edges)
    const sim = new Simulator(circuit)
    const ms = {
      compileRanges: time(200, () => compileRanges(nodes, edges)),
      flowToCircuit: time(200, () => flowToCircuit(nodes, edges)),
      liveEval: time(200, () => sim.eval(inputValues(nodes))),
      edgeWidths: time(200, () => edges.map((e) => edgeWidth(nodes, e))),
      structureKey: time(200, () => structureKey(nodes, edges)),
    }
    console.log('M6 ms per call (150 nodes):', JSON.stringify(ms, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)))
    expect(ms.structureKey).toBeLessThan(5) // the key must stay much cheaper than what it saves
  })

  it('the structure key ignores positions and selection, but sees wires, pin widths, ranges and input values', () => {
    const base = structureKey(nodes, edges)
    const moved = nodes.map((n, i) => (i === 20 ? { ...n, position: { x: 999, y: 999 }, selected: true } : n))
    expect(structureKey(moved, edges)).toBe(base)
    expect(structureKey(nodes, edges.slice(1))).not.toBe(base)
    const wider = nodes.map((n) => (n.id === 'inpin0' ? ({ ...n, data: { ...n.data, width: 4 } } as AppNode) : n))
    expect(structureKey(wider, edges)).not.toBe(base)
    const ranged = nodes.map((n) => (n.id === 'inpin0' ? ({ ...n, data: { ...n.data, ranges: [{ pin: 'out', lo: 0, hi: 0 }] } } as AppNode) : n))
    expect(structureKey(ranged, edges)).not.toBe(base)
    const typed = nodes.map((n) => (n.id === 'inpin1' ? ({ ...n, data: { ...n.data, inputValue: 1 - (n.data as { inputValue: number }).inputValue } } as AppNode) : n))
    expect(structureKey(typed, edges)).not.toBe(base) // live values depend on input values
  })
})
