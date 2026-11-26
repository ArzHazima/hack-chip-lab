// How .hack programs and the Keyboard key travel from the board (node data) into the engine circuit,
// and that file loading accepts .hack without turning it into an exercise chip.

import { describe, expect, it } from 'vitest'
import { groupExerciseFiles } from '../engine/exercise'
import { Simulator } from '../engine/sequential'
import { flowToCircuit } from './flowToCircuit'
import { readExerciseFiles } from './fileLoading'
import { sanitizeCircuit } from './storage'
import type { AppNode } from './types'

const chip = (id: string, data: { type: string; hackFile?: string; keyValue?: number }): AppNode => ({
  id,
  type: 'chip',
  position: { x: 0, y: 0 },
  data,
})
const inPin = (id: string, name: string, width: number): AppNode => ({ id, type: 'inpin', position: { x: 0, y: 0 }, data: { name, width } })
const outPin = (id: string, name: string, width: number): AppNode => ({ id, type: 'outpin', position: { x: 0, y: 0 }, data: { name, width } })
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
})

describe('flowToCircuit: ROM32K program and Keyboard key', () => {
  const programs = new Map<string, readonly number[]>([['Add.hack', [7, 8, 9]]])

  it('gives a ROM32K the words of its chosen .hack file, and the circuit really reads them', () => {
    const nodes = [inPin('a', 'address', 15), chip('rom', { type: 'ROM32K', hackFile: 'Add.hack' }), outPin('o', 'out', 16)]
    const edges = [edge('e1', 'a', 'out', 'rom', 'address'), edge('e2', 'rom', 'out', 'o', 'in')]
    const { circuit, errors, warnings } = flowToCircuit(nodes, edges, programs)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(circuit.chips[0].program).toEqual([7, 8, 9])
    const sim = new Simulator(circuit)
    expect(sim.eval({ address: 2 }).outputs.out).toBe(9)
    sim.reset()
    expect(sim.eval({ address: 1 }).outputs.out).toBe(8) // Reset keeps the program
  })

  it('a .hack file that is not loaded is a warning (empty ROM), not an error', () => {
    const nodes = [chip('rom', { type: 'ROM32K', hackFile: 'Gone.hack' })]
    const { circuit, errors, warnings } = flowToCircuit(nodes, [], programs)
    expect(circuit.chips[0].program).toBeUndefined()
    expect(errors.some((e) => /Gone\.hack/.test(e))).toBe(false)
    expect(warnings[0]).toMatch(/Gone\.hack is not loaded/)
  })

  it('no file chosen: no program and no warning', () => {
    const { circuit, warnings } = flowToCircuit([chip('rom', { type: 'ROM32K' })], [], programs)
    expect(circuit.chips[0].program).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('a Keyboard node passes its key code to the chip (0 = nothing set)', () => {
    const nodes = [chip('kb', { type: 'Keyboard', keyValue: 75 }), outPin('o', 'out', 16)]
    const { circuit } = flowToCircuit(nodes, [edge('e1', 'kb', 'out', 'o', 'in')])
    expect(circuit.chips[0].key).toBe(75)
    expect(new Simulator(circuit).eval({}).outputs.out).toBe(75)
    expect(flowToCircuit([chip('kb', { type: 'Keyboard' })], []).circuit.chips[0].key).toBeUndefined()
  })
})

describe('saved boards keep the ROM32K file name and the Keyboard key', () => {
  const node = (data: Record<string, unknown>) => ({ id: 'n1', type: 'chip', position: { x: 1, y: 2 }, data })

  it('sanitizeCircuit (what loadCircuit uses) does not drop hackFile / keyValue', () => {
    const rom = sanitizeCircuit({ nodes: [node({ type: 'ROM32K', hackFile: 'Add.hack' })], edges: [] })
    expect(rom?.nodes[0].data).toMatchObject({ type: 'ROM32K', hackFile: 'Add.hack' })
    const kb = sanitizeCircuit({ nodes: [node({ type: 'Keyboard', keyValue: 130 })], edges: [] })
    expect(kb?.nodes[0].data).toMatchObject({ type: 'Keyboard', keyValue: 130 })
  })

  it('bad values are left out but the node stays', () => {
    const bad = sanitizeCircuit({ nodes: [node({ type: 'Memory', hackFile: 5, keyValue: -3 })], edges: [] })
    expect(bad?.nodes).toHaveLength(1)
    expect(bad?.nodes[0].data).toEqual({ type: 'Memory' })
    const huge = sanitizeCircuit({ nodes: [node({ type: 'Keyboard', keyValue: 70000 })], edges: [] })
    expect((huge?.nodes[0].data as { keyValue?: number }).keyValue).toBeUndefined()
  })
})

describe('.hack in file loading', () => {
  it('readExerciseFiles reads .hack files like the other three extensions', async () => {
    const files = [new File(['0000000000000001\n'], 'Prog.hack'), new File(['x'], 'notes.txt'), new File(['y'], 'A.hdl')]
    const { files: read } = await readExerciseFiles(files)
    expect(read.map((f) => f.name).sort()).toEqual(['A.hdl', 'Prog.hack'])
  })

  it('a .hack file is not an exercise chip (it would show up as a chip with three missing files)', () => {
    const chips = groupExerciseFiles([
      { name: 'Prog.hack', text: '0000000000000001' },
      { name: 'Bit.hdl', text: 'CHIP Bit { IN in; OUT out; PARTS: }' },
    ])
    expect(chips.map((c) => c.name)).toEqual(['Bit'])
  })
})
