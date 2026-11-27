// A string that changes when the CIRCUIT changes but not when a node is only dragged or selected (M6).
//
// While a node is dragged, React Flow gives App a new `nodes` array on every mouse move (only `position` differs).
// Anything that depends on the wiring, not on the positions, can be memoised on this key instead of on `nodes`.
// Included: node id / type / chip type / params / pin name+width / range handles / hack file / key / input value,
// and every wire's ends and handles. Left out: position, selection, measured size, display-only values.

import type { Edge } from '@xyflow/react'
import type { AppNode } from './types'

export function structureKey(nodes: readonly AppNode[], edges: readonly Edge[]): string {
  const parts: string[] = []
  for (const n of nodes) {
    const d = n.data as Record<string, unknown>
    parts.push(
      [n.id, n.type, d.type ?? '', d.name ?? '', d.width ?? '', d.inputValue ?? '', d.hackFile ?? '', d.keyValue ?? '', d.params ? JSON.stringify(d.params) : '', d.ranges ? JSON.stringify(d.ranges) : ''].join('~'),
    )
  }
  parts.push('|')
  for (const e of edges) parts.push(`${e.id}~${e.source}~${e.sourceHandle ?? ''}~${e.target}~${e.targetHandle ?? ''}`)
  return parts.join('\n')
}
