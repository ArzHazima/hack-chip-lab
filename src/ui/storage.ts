// Per-chip circuit autosave. localStorage can be missing, full or blocked (private
// windows), so every access is wrapped in try/catch and the app works without it.

import type { Edge } from '@xyflow/react'
import type { AppNode } from './types'

export interface SavedCircuit {
  nodes: AppNode[]
  edges: Edge[]
}

/** Slot used for the manual board (no chip selected). */
export const MANUAL_SLOT = '__manual__'

const key = (slot: string) => `hacklab:circuit:${slot}`

export function saveCircuit(slot: string, data: SavedCircuit): void {
  try {
    localStorage.setItem(key(slot), JSON.stringify(data))
  } catch {
    /* storage unavailable or full: the in-memory copy still works */
  }
}

export function loadCircuit(slot: string): SavedCircuit | null {
  try {
    const raw = localStorage.getItem(key(slot))
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<SavedCircuit>
    // Reject anything that does not look like a saved circuit instead of crashing on it.
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null
    return { nodes: data.nodes, edges: data.edges }
  } catch {
    return null
  }
}
