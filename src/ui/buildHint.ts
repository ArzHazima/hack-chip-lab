// Run on a board that is still empty or not wired at all should say what to do, not only name a missing pin.

import type { Edge } from '@xyflow/react'
import type { AppNode } from './types'

export const BUILD_FIRST = 'Build the circuit first: pick blocks on the left and connect them to the pins.'

/** True when no wire reaches any output pin: nothing was built yet (an empty board, or pins with no wires). */
export function needsBuilding(nodes: readonly AppNode[], edges: readonly Edge[]): boolean {
  const outPins = new Set(nodes.filter((n) => n.type === 'outpin').map((n) => n.id))
  return !edges.some((e) => outPins.has(e.target))
}

/** The errors to show: the "build first" sentence in front of the engine's own pin errors (if any). */
export function withBuildHint(nodes: readonly AppNode[], edges: readonly Edge[], errors: string[]): string[] {
  return needsBuilding(nodes, edges) ? [BUILD_FIRST, ...errors] : errors
}
