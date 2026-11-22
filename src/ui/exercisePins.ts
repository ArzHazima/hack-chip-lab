// Creating / updating the board's input and output pins from a chip's HDL interface.

import type { Edge } from '@xyflow/react'
import { assertInterfaceWidths, type HdlInterface, type PinSpec } from '../engine/hdl'
import type { AppNode } from './types'

const ROW = 90 // vertical gap between pins on the board
const OUT_X = 640 // outputs go to the right of the inputs

/** Highest number used at the end of a node id (And3 -> 3), so new ids never collide. */
export function maxIdNumber(nodes: AppNode[]): number {
  return nodes.reduce((max, n) => Math.max(max, Number(n.id.match(/(\d+)$/)?.[1] ?? 0)), 0)
}

function pinNode(kind: 'inpin' | 'outpin', spec: PinSpec, index: number, id: number): AppNode {
  return {
    id: `${kind}${id}`,
    type: kind,
    position: { x: kind === 'inpin' ? 0 : OUT_X, y: index * ROW },
    data: { name: spec.name, width: spec.width },
  }
}

/** A fresh board with one pin per IN / OUT declaration. `nextId` supplies unique numbers. */
export function pinsFromInterface(iface: HdlInterface, nextId: () => number): AppNode[] {
  assertInterfaceWidths(iface) // throws HdlParseError for a pin wider than 16 bits
  return [
    ...iface.inputs.map((p, i) => pinNode('inpin', p, i, nextId())),
    ...iface.outputs.map((p, i) => pinNode('outpin', p, i, nextId())),
  ]
}

/**
 * Brings a saved circuit in line with the (possibly changed) interface: pins that are no
 * longer declared are removed together with their wires, pins whose width changed are
 * updated, and missing pins are added. Chips and other wires are left alone.
 */
export function reconcilePins(
  nodes: AppNode[],
  edges: Edge[],
  iface: HdlInterface,
  nextId: () => number,
): { nodes: AppNode[]; edges: Edge[] } {
  const wanted = (kind: 'inpin' | 'outpin') => (kind === 'inpin' ? iface.inputs : iface.outputs)
  const removed = new Set<string>()
  let out: AppNode[] = []
  for (const n of nodes) {
    if (n.type === 'chip') {
      out.push(n)
      continue
    }
    const spec = wanted(n.type).find((p) => p.name === n.data.name)
    if (!spec) removed.add(n.id)
    else out.push(spec.width === n.data.width ? n : ({ ...n, data: { ...n.data, width: spec.width } } as AppNode))
  }
  for (const kind of ['inpin', 'outpin'] as const) {
    wanted(kind).forEach((spec, i) => {
      if (!out.some((n) => n.type === kind && n.data.name === spec.name)) out.push(pinNode(kind, spec, i, nextId()))
    })
  }
  out = out.slice()
  return { nodes: out, edges: edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) }
}
