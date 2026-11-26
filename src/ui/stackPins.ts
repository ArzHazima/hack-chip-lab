// Keeps the input pin nodes (and the output pin nodes) of the board from overlapping each other.
// Pin nodes grow when a test row is selected (an extra "test row" block) or when a bit strip / range column
// is open, so a fixed vertical gap is never enough. Instead, pins in the same column are pushed DOWN just far
// enough, using their measured heights. Only the shown position changes; the stored one is left alone.

import type { AppNode } from './types'

const GAP = 24 // free space kept between two pins in a column
const SAME_COLUMN = 60 // pins whose x differ by less than this are in the same column

/** `heights`: measured visual height per node id, including an open range column (missing = not measured yet). */
export function stackPins(nodes: AppNode[], heights: Record<string, number>): AppNode[] {
  const pushed = new Map<string, number>() // id -> new y
  for (const type of ['inpin', 'outpin'] as const) {
    const columns: AppNode[][] = []
    for (const n of nodes.filter((x) => x.type === type).sort((a, b) => a.position.x - b.position.x)) {
      const col = columns.find((c) => Math.abs(c[0].position.x - n.position.x) < SAME_COLUMN)
      if (col) col.push(n)
      else columns.push([n])
    }
    for (const col of columns) {
      col.sort((a, b) => a.position.y - b.position.y)
      let bottom = -Infinity
      for (const n of col) {
        const y = Math.max(n.position.y, bottom + GAP)
        if (y !== n.position.y) pushed.set(n.id, y)
        bottom = y + (heights[n.id] ?? 0)
      }
    }
  }
  if (pushed.size === 0) return nodes
  return nodes.map((n) => (pushed.has(n.id) ? { ...n, position: { ...n.position, y: pushed.get(n.id)! } } : n))
}
