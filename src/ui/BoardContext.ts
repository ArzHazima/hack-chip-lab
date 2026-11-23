import { createContext } from 'react'
import type { FormatMode } from './formatValue'

// Lets a node component talk to App without passing callbacks through React Flow's node data
// (which would pollute the saved graph): editing an input pin, and the toolbar's number format.
export const BoardContext = createContext<{
  setInputValue: (nodeId: string, value: number) => void
  format: FormatMode
}>({
  setInputValue: () => {},
  format: 'all',
})
