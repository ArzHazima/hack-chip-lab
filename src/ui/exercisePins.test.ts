import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { parseHdlInterface } from '../engine/hdl'
import { maxIdNumber, pinsFromInterface, reconcilePins } from './exercisePins'
import type { AppNode } from './types'

const iface = parseHdlInterface('CHIP X { IN a[16], sel; OUT out[16], zr; PARTS: }')
const counter = (start = 1) => {
  let n = start
  return () => n++
}

describe('pins from the HDL interface', () => {
  it('creates one pin node per IN/OUT with the right name, width and side', () => {
    const nodes = pinsFromInterface(iface, counter())
    expect(nodes.map((n) => [n.type, (n.data as { name: string; width: number }).name, (n.data as { width: number }).width])).toEqual([
      ['inpin', 'a', 16], ['inpin', 'sel', 1], ['outpin', 'out', 16], ['outpin', 'zr', 1],
    ])
    expect(new Set(nodes.map((n) => n.id)).size).toBe(4) // unique ids
    expect(nodes[0].position.x).toBeLessThan(nodes[2].position.x) // inputs left, outputs right
  })

  it('reconcile adds missing pins, fixes widths, drops removed pins with their wires', () => {
    const old: AppNode[] = [
      { id: 'inpin1', type: 'inpin', position: { x: 0, y: 0 }, data: { name: 'a', width: 8 } }, // width changed
      { id: 'inpin2', type: 'inpin', position: { x: 0, y: 90 }, data: { name: 'gone', width: 1 } }, // removed
      { id: 'And3', type: 'chip', position: { x: 300, y: 0 }, data: { type: 'And' } },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'inpin1', target: 'And3' },
      { id: 'e2', source: 'inpin2', target: 'And3' },
    ]
    const r = reconcilePins(old, edges, iface, counter(maxIdNumber(old) + 1))
    const pins = r.nodes.filter((n) => n.type !== 'chip').map((n) => (n.data as { name: string; width: number }))
    expect(pins).toEqual(expect.arrayContaining([
      { name: 'a', width: 16 }, { name: 'sel', width: 1 }, { name: 'out', width: 16 }, { name: 'zr', width: 1 },
    ]))
    expect(pins.find((p) => p.name === 'gone')).toBeUndefined()
    expect(r.nodes.some((n) => n.type === 'chip')).toBe(true)
    expect(r.edges.map((e) => e.id)).toEqual(['e1'])
    expect(new Set(r.nodes.map((n) => n.id)).size).toBe(r.nodes.length)
  })

  it('maxIdNumber reads the trailing number of ids', () => {
    expect(maxIdNumber([])).toBe(0)
    expect(maxIdNumber([{ id: 'And7', type: 'chip', position: { x: 0, y: 0 }, data: { type: 'And' } }])).toBe(7)
  })
})
