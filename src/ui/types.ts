import type { Node } from '@xyflow/react'

// React Flow node payloads. (`type` aliases, not interfaces: React Flow needs
// data to be assignable to Record<string, unknown>.)
/** Settings of a Split / Join / Const node. `ranges` is the text the user typed ("0..7, 8..15"). */
export type BusParams = { width: number; ranges?: string; ones?: boolean }
// stored: live DFF/PC value (display only); params: only for Split / Join / Const
export type ChipData = { type: string; stored?: number; params?: BusParams }
export type PinData = { name: string; width: number; value?: number; inputValue?: number }

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
