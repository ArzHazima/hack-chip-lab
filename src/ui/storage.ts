// Per-chip circuit autosave. localStorage can be missing, full or blocked (private
// windows), so every access is wrapped in try/catch and the app works without it.

import type { Edge } from '@xyflow/react'
import { CHIPS, MAX_WIDTH } from '../engine/chips'
import { parseHdlInterface, type HdlInterface } from '../engine/hdl'
import type { AppNode, ChipData, PinData, PinRange } from './types'

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

// ---- Validation of what comes back from localStorage ----------------------------------------------
// localStorage is user-editable (and other tabs or old versions write to it), so a saved circuit is
// UNTRUSTED input. Every node and edge is rebuilt from known fields only: unknown node types, wrong
// shapes and non-numbers are dropped, so a bad item can neither crash the app nor smuggle odd keys
// (`constructor`, `__proto__`) into the chip lookup.

const MAX_SAVED_BYTES = 5_000_000 // a real circuit is a few KB
const MAX_SAVED_NODES = 2_000
const MAX_SAVED_EDGES = 10_000
const BUS_TYPES = ['Split', 'Join', 'Const']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 200
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isWidth = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_WIDTH
const isBit = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_WIDTH

/** A known chip type: an OWN key of CHIPS (so "constructor" / "toString" do not count) or a bus node. */
const isKnownChip = (t: unknown): t is string =>
  typeof t === 'string' && (BUS_TYPES.includes(t) || Object.prototype.hasOwnProperty.call(CHIPS, t))

/** The valid range handles of a node; undefined if absent, null if present but not an array. */
function cleanRanges(v: unknown): PinRange[] | undefined | null {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) return null
  return v
    .filter((r): r is Obj => isObj(r) && isStr(r.pin) && isBit(r.lo) && isBit(r.hi) && r.lo <= r.hi)
    .slice(0, 200)
    .map((r) => ({ pin: r.pin as string, lo: r.lo as number, hi: r.hi as number }))
}

function cleanNode(n: unknown): AppNode | null {
  if (!isObj(n) || !isStr(n.id) || n.id === '' || !isObj(n.data) || !isObj(n.position)) return null
  if (!isNum(n.position.x) || !isNum(n.position.y)) return null
  const position = { x: n.position.x, y: n.position.y }
  const d = n.data
  const ranges = cleanRanges(d.ranges)
  if (ranges === null) return null
  if (n.type === 'chip') {
    if (!isKnownChip(d.type)) return null
    const data: ChipData = { type: d.type }
    if (d.stored !== undefined) {
      if (!isNum(d.stored)) return null
      data.stored = d.stored
    }
    if (d.params !== undefined) {
      const p = d.params
      if (!isObj(p) || !isWidth(p.width)) return null
      if (p.ranges !== undefined && (typeof p.ranges !== 'string' || p.ranges.length > 500)) return null
      if (p.ones !== undefined && typeof p.ones !== 'boolean') return null
      data.params = { width: p.width }
      if (p.ranges !== undefined) data.params.ranges = p.ranges
      if (p.ones !== undefined) data.params.ones = p.ones
    }
    if (ranges) data.ranges = ranges
    return { id: n.id, type: 'chip', position, data }
  }
  if (n.type === 'inpin' || n.type === 'outpin') {
    if (!isStr(d.name) || !isWidth(d.width)) return null
    const data: PinData = { name: d.name, width: d.width }
    for (const k of ['value', 'inputValue'] as const) {
      if (d[k] === undefined) continue
      if (!isNum(d[k])) return null
      data[k] = d[k]
    }
    if (ranges) data.ranges = ranges
    return { id: n.id, type: n.type, position, data }
  }
  return null // unknown node type
}

function cleanEdge(e: unknown, ids: Set<string>): Edge | null {
  if (!isObj(e) || !isStr(e.id) || !isStr(e.source) || !isStr(e.target)) return null
  if (!ids.has(e.source) || !ids.has(e.target)) return null // dangling wire: its node was dropped
  const okHandle = (h: unknown) => h === undefined || h === null || isStr(h)
  if (!okHandle(e.sourceHandle) || !okHandle(e.targetHandle)) return null
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle as string | null | undefined,
    targetHandle: e.targetHandle as string | null | undefined,
  }
}

/** Rebuilds a saved circuit from untrusted data. Invalid items are dropped; garbage gives null. */
export function sanitizeCircuit(data: unknown): SavedCircuit | null {
  if (!isObj(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null
  if (data.nodes.length > MAX_SAVED_NODES || data.edges.length > MAX_SAVED_EDGES) return null
  const nodes: AppNode[] = []
  const ids = new Set<string>()
  for (const raw of data.nodes) {
    const n = cleanNode(raw)
    if (n && !ids.has(n.id)) {
      ids.add(n.id)
      nodes.push(n)
    }
  }
  const edges: Edge[] = []
  const edgeIds = new Set<string>()
  for (const raw of data.edges) {
    const e = cleanEdge(raw, ids)
    if (e && !edgeIds.has(e.id)) {
      edgeIds.add(e.id)
      edges.push(e)
    }
  }
  return { nodes, edges }
}

export function loadCircuit(slot: string): SavedCircuit | null {
  try {
    const raw = localStorage.getItem(key(slot))
    if (!raw || raw.length > MAX_SAVED_BYTES) return null
    return sanitizeCircuit(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Removes every saved circuit (the "Clear saved circuit" button of the error screen). */
export function clearSavedCircuits(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('hacklab:circuit:')) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* no storage: nothing to clear */
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
