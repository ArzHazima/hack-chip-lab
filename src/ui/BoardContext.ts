import { createContext } from 'react'
import type { FormatMode } from './formatValue'
import type { BitRange } from './ranges'
import type { PinRange } from './types'

/** A loaded .hack program the ROM32K block can pick. */
export interface HackFileInfo {
  name: string // file name, e.g. "Add.hack"
  words: number // number of instructions
}

// Lets a node component talk to App without passing callbacks through React Flow's node data
// (which would pollute the saved graph): editing an input pin, the toolbar's number format, and
// adding / removing the bit-range handles of a pin, plus the ROM32K program picker and the Keyboard key.
export const BoardContext = createContext<{
  setInputValue: (nodeId: string, value: number) => void
  format: FormatMode
  /** Create range handles on one pin of a node (`width` = width of that pin). Duplicates are skipped. */
  addRanges: (nodeId: string, pin: string, ranges: BitRange[], width: number) => void
  /** Remove a range handle together with the wires attached to it. */
  removeRange: (nodeId: string, range: PinRange) => void
  /** The loaded .hack files (for the ROM32K dropdown). */
  hackFiles: HackFileInfo[]
  /** ROM32K: choose a loaded .hack file ('' = none). Restarts the simulation. */
  setHackFile: (nodeId: string, name: string) => void
  /** Keyboard / Memory: the key code that is held (0 = no key). Applies to a running simulation at once. */
  setKeyValue: (nodeId: string, key: number) => void
}>({
  setInputValue: () => {},
  format: 'all',
  addRanges: () => {},
  removeRange: () => {},
  hackFiles: [],
  setHackFile: () => {},
  setKeyValue: () => {},
})
