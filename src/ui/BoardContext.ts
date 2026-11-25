import { createContext } from 'react'
import type { FormatMode } from './formatValue'
import type { BitRange } from './ranges'
import type { PinRange } from './types'

// Lets a node component talk to App without passing callbacks through React Flow's node data
// (which would pollute the saved graph): editing an input pin, the toolbar's number format, and
// adding / removing the bit-range handles of a pin.
export const BoardContext = createContext<{
  setInputValue: (nodeId: string, value: number) => void
  format: FormatMode
  /** Create range handles on one pin of a node (`width` = width of that pin). Duplicates are skipped. */
  addRanges: (nodeId: string, pin: string, ranges: BitRange[], width: number) => void
  /** Remove a range handle together with the wires attached to it. */
  removeRange: (nodeId: string, range: PinRange) => void
}>({
  setInputValue: () => {},
  format: 'all',
  addRanges: () => {},
  removeRange: () => {},
})
