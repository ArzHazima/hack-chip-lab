// Per-chip circuit autosave. localStorage can be missing, full or blocked (private
// windows), so every access is wrapped in try/catch and the app works without it.

import type { Edge } from '@xyflow/react'
import { parseHdlInterface, type HdlInterface } from '../engine/hdl'
import type { AppNode } from './types'

export interface SavedCircuit {
  nodes: AppNode[]
  edges: Edge[]
}

/** Slot used for the manual board (no chip selected). */
export const MANUAL_SLOT = '__manual__'

const key = (slot: string) => `hacklab:circuit:${slot}`

/**
 * Short fingerprint of a chip's INTERFACE (IN/OUT names and widths; PARTS is ignored; the order
 * of the pins does not matter). 32-bit FNV-1a: tiny, and good enough to tell two exercises apart.
 */
export function interfaceHash(iface: HdlInterface | null): string {
  if (!iface) return 'nohdl'
  const side = (pins: { name: string; width: number }[]) => pins.map((p) => `${p.name}[${p.width}]`).sort().join(',')
  const text = `in:${side(iface.inputs)}|out:${side(iface.outputs)}`
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * The storage slot of a chip's circuit: its name PLUS its interface fingerprint. Two exercise
 * folders that both contain a chip called "Mux" but with different pins therefore never
 * restore each other's circuit. A chip without a readable .hdl gets the fingerprint "nohdl".
 */
export function chipSlot(chip: { name: string; hdl?: { text: string } }): string {
  let iface: HdlInterface | null = null
  try {
    iface = chip.hdl ? parseHdlInterface(chip.hdl.text) : null
  } catch {
    /* unreadable .hdl: use the "nohdl" slot; the app shows the parse error separately */
  }
  return `${chip.name}#${interfaceHash(iface)}`
}

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

// Tiny preferences (chosen number format, "help already shown"): same rule as the circuits,
// localStorage may be missing or blocked, so every access is wrapped in try/catch.
export function getPref(name: string): string | null {
  try {
    return localStorage.getItem(`hacklab:pref:${name}`)
  } catch {
    return null
  }
}

export function setPref(name: string, value: string): void {
  try {
    localStorage.setItem(`hacklab:pref:${name}`, value)
  } catch {
    /* ignore: the preference just will not be remembered */
  }
}
