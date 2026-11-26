import type { Node } from '@xyflow/react'

// React Flow node payloads. (`type` aliases, not interfaces: React Flow needs
// data to be assignable to Record<string, unknown>.)
/** Settings of a Split / Join / Const node. `ranges` is the text the user typed ("0..7, 8..15"). */
export type BusParams = { width: number; ranges?: string; ones?: boolean }
/**
 * A bit range of ONE pin that has its own handle on the node (`a[4..7]`). `pin` is the pin's handle id
 * ('a' for a chip pin, 'out' / 'in' for the input / output pin nodes). Saved with the circuit.
 */
export type PinRange = { pin: string; lo: number; hi: number }
/** A problem with a pin's ranges, shown on that pin (display only, never saved). */
export type PinIssue = { pin: string; message: string }

// stored: live DFF/PC value (display only); params: only for Split / Join / Const;
// ranges: the range handles of this node's pins (optional, so circuits saved before ranges still load)
// hackFile: ROM32K only, the name of the loaded .hack file it reads (saved with the board; the words are looked up
// when the circuit is built). keyValue: Keyboard / Memory, the key code that is held. romWords: display only.
export type ChipData = {
  type: string
  stored?: number
  params?: BusParams
  ranges?: PinRange[]
  issues?: PinIssue[]
  hackFile?: string
  keyValue?: number
  romWords?: number
}
export type PinData = {
  name: string
  width: number
  value?: number
  inputValue?: number
  ranges?: PinRange[]
  issues?: PinIssue[]
}

export type ChipNodeT = Node<ChipData, 'chip'>
export type InPinNodeT = Node<PinData, 'inpin'>
export type OutPinNodeT = Node<PinData, 'outpin'>
export type AppNode = ChipNodeT | InPinNodeT | OutPinNodeT

/** What the sidebar puts on the drag clipboard. */
export type DragItem =
  | { kind: 'chip'; type: string }
  | { kind: 'inpin' | 'outpin'; name: string; width: number }
  | { kind: 'bus'; type: 'Split' | 'Join' | 'Const'; params: BusParams }

export const DRAG_MIME = 'application/x-hacklab-item'

// ---- What the results table and the board need, whichever flow produced them ----

/** Values at one result row: lets the board show pin values and colour wires. */
export interface Snap {
  inputs: Record<string, number>
  outputs: Record<string, number>
  wireValues: Record<string, number>
}

export interface RunRow {
  index: number
  pass: boolean
  cells: string[] // one text per header (inputs / expected / actual ...)
  snap?: Snap
}

export interface RunView {
  ok: boolean // everything passed and the row counts match
  passed: number
  total: number
  headers: string[]
  rows: RunRow[]
  note?: string // extra line under the summary (column list, row-count mismatch ...)
}
