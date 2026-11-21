// Converts the React Flow graph (nodes/edges) into the engine's Circuit model.
// This is the only place where UI data and engine data meet.

import type { Edge } from '@xyflow/react'
import { CHIPS } from '../engine/chips'
import type { Circuit, Endpoint } from '../engine/circuit'
import type { AppNode } from './types'

function endpoint(node: AppNode, handle: string): Endpoint {
  // Chip handles are named after the chip pin; pin nodes have a single handle.
  return node.type === 'chip' ? { chip: node.id, pin: handle } : { pin: node.id }
}

export function flowToCircuit(nodes: AppNode[], edges: Edge[]): { circuit: Circuit; errors: string[] } {
  const circuit: Circuit = { pins: [], chips: [], wires: [] }
  const errors: string[] = []
  const names = new Set<string>()

  for (const n of nodes) {
    if (n.type === 'chip') {
      circuit.chips.push({ id: n.id, type: n.data.type })
    } else {
      const name = n.data.name.trim()
      if (!name) errors.push('A pin has an empty name')
      else if (names.has(name)) errors.push(`Two pins are both named "${name}"`)
      names.add(name)
      circuit.pins.push({
        id: n.id,
        name,
        kind: n.type === 'inpin' ? 'input' : 'output',
        width: n.data.width,
      })
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const e of edges) {
    const src = byId.get(e.source)
    const dst = byId.get(e.target)
    if (!src || !dst) continue
    circuit.wires.push({
      id: e.id,
      from: endpoint(src, e.sourceHandle ?? ''),
      to: endpoint(dst, e.targetHandle ?? ''),
    })
  }
  return { circuit, errors }
}

/** Bit width carried by an edge (taken from its source pin), for the wire label. */
export function edgeWidth(nodes: AppNode[], edge: Edge): number {
  const src = nodes.find((n) => n.id === edge.source)
  if (!src) return 1
  if (src.type === 'chip') {
    return CHIPS[src.data.type]?.outputs.find((p) => p.name === edge.sourceHandle)?.width ?? 1
  }
  return src.data.width
}

/** Values typed into the input pins on the board, keyed by pin name (default 0). */
export function inputValues(nodes: AppNode[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of nodes) if (n.type === 'inpin') out[n.data.name.trim()] = n.data.inputValue ?? 0
  return out
}
