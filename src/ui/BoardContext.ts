import { createContext } from 'react'

// Lets a node component (the input-pin value box) talk to App without passing
// callbacks through React Flow's node data (which would pollute the saved graph).
export const BoardContext = createContext<{ setInputValue: (nodeId: string, value: number) => void }>({
  setInputValue: () => {},
})
