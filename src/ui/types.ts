import type { Node } from '@xyflow/react'

// React Flow node payloads. (`type` aliases, not interfaces: React Flow needs
// data to be assignable to Record<string, unknown>.)
export type ChipData = { type: string }
export type PinData = { name: string; width: number; value?: number }

export type ChipNodeT = Node<ChipData, 'chip'>
export type InPinNodeT = Node<PinData, 'inpin'>
export type OutPinNodeT = Node<PinData, 'outpin'>
export type AppNode = ChipNodeT | InPinNodeT | OutPinNodeT

/** What the sidebar puts on the drag clipboard. */
export type DragItem =
  | { kind: 'chip'; type: string }
  | { kind: 'inpin' | 'outpin'; name: string; width: number }

export const DRAG_MIME = 'application/x-hacklab-item'
