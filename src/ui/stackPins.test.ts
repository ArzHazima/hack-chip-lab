import { describe, expect, it } from 'vitest'
import { stackPins } from './stackPins'
import type { AppNode } from './types'

const pin = (id: string, y: number, type: 'inpin' | 'outpin' = 'inpin', x = 0): AppNode => ({
  id, type, position: { x, y }, data: { name: id, width: 16 },
})
const ys = (ns: AppNode[]) => ns.map((n) => n.position.y)

describe('stackPins', () => {
  it('leaves pins alone when they do not overlap', () => {
    const nodes = [pin('a', 0), pin('b', 300)]
    expect(stackPins(nodes, { a: 100, b: 100 })).toBe(nodes) // same array: nothing changed
  })

  it('pushes a pin down when the one above it grew (e.g. a selected test row)', () => {
    const out = stackPins([pin('a', 0), pin('b', 120), pin('c', 240)], { a: 220, b: 220, c: 220 })
    expect(ys(out)).toEqual([0, 244, 488]) // each starts 24 px below the previous bottom
  })

  it('accounts for an open range column that is taller than the pin', () => {
    expect(ys(stackPins([pin('a', 0), pin('b', 120)], { a: 400, b: 100 }))).toEqual([0, 424])
  })

  it('stacks inputs and outputs separately and ignores other nodes', () => {
    const chip: AppNode = { id: 'And1', type: 'chip', position: { x: 0, y: 50 }, data: { type: 'And' } }
    const out = stackPins([pin('a', 0), pin('o', 10, 'outpin', 1000), chip, pin('b', 100)], { a: 200, o: 200, b: 50 })
    expect(out.map((n) => [n.id, n.position.y])).toEqual([['a', 0], ['o', 10], ['And1', 50], ['b', 224]])
  })

  it('works from the stored order, not the array order, and never moves a pin up', () => {
    const out = stackPins([pin('b', 500), pin('a', 0)], { a: 100, b: 100 })
    expect(ys(out)).toEqual([500, 0])
  })

  it('does nothing without measurements (first render)', () => {
    const nodes = [pin('a', 0), pin('b', 10)]
    expect(ys(stackPins(nodes, {}))).toEqual([0, 24])
  })
})
