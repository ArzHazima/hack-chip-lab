// "Load solution": the bundled circuits in public/examples/solutions/ must pass their own chip's test,
// loaded the same way the app does it (fetch -> sanitizeCircuit -> reconcilePins -> flowToCircuit -> runExercise).

import { describe, expect, it } from 'vitest'
import { groupExerciseFiles, runExercise } from '../src/engine/exercise'
import { parseHdlInterface } from '../src/engine/hdl'
import { needsBuilding, withBuildHint, BUILD_FIRST } from '../src/ui/buildHint'
import { pinsFromInterface, reconcilePins, maxIdNumber } from '../src/ui/exercisePins'
import { fetchExampleFiles, fetchSolution, fetchSolutionNames, readExerciseFiles } from '../src/ui/fileLoading'
import { flowToCircuit } from '../src/ui/flowToCircuit'

const served = import.meta.glob('../public/examples/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fakeFetch = (async (url: string) => {
  const text = served[`../public/${url.slice(url.indexOf('examples/'))}`]
  return text === undefined ? new Response('nope', { status: 404 }) : new Response(text)
}) as unknown as typeof fetch

describe('bundled solutions', () => {
  it('index.json lists Mirror16 and Pick4of16', async () => {
    const names = await fetchSolutionNames('/', fakeFetch)
    expect(names).toEqual(expect.arrayContaining(['Mirror16', 'Pick4of16']))
  })

  for (const name of ['Mirror16', 'Pick4of16']) {
    it(`${name}: the solution passes every row of its test`, async () => {
      const chips = groupExerciseFiles((await readExerciseFiles(await fetchExampleFiles('/', fakeFetch))).files)
      const chip = chips.find((c) => c.name === name)!
      const saved = await fetchSolution('/', name, fakeFetch)
      let next = maxIdNumber(saved.nodes) + 1
      const fixed = reconcilePins(saved.nodes, saved.edges, parseHdlInterface(chip.hdl!.text), () => next++)
      const { circuit, errors } = flowToCircuit(fixed.nodes, fixed.edges)
      expect(errors).toEqual([])
      const result = runExercise(circuit, chip.tst!.text, chip.cmp!.text)
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows.every((r) => r.pass)).toBe(true)
      expect(result.passed).toBe(result.total)
    })
  }

  it('a missing solution is a readable error', async () => {
    await expect(fetchSolution('/', 'Nope', fakeFetch)).rejects.toThrow(/HTTP 404/)
    await expect(fetchSolution('/', '../x', fakeFetch)).rejects.toThrow(/not a valid/)
  })
})

describe('"Build the circuit first" hint', () => {
  const pins = pinsFromInterface(parseHdlInterface('CHIP X { IN a; OUT out; PARTS: }'), (() => { let n = 1; return () => n++ })())
  it('an empty board and pins without wires need building', () => {
    expect(needsBuilding([], [])).toBe(true)
    expect(needsBuilding(pins, [])).toBe(true)
    expect(withBuildHint(pins, [], ['pin out is not connected'])).toEqual([BUILD_FIRST, 'pin out is not connected'])
  })
  it('a wire into an output pin means it was built (no hint)', () => {
    const out = pins.find((n) => n.type === 'outpin')!
    const inp = pins.find((n) => n.type === 'inpin')!
    const edges = [{ id: 'e', source: inp.id, sourceHandle: 'out', target: out.id, targetHandle: 'in' }]
    expect(needsBuilding(pins, edges)).toBe(false)
    expect(withBuildHint(pins, edges, ['x'])).toEqual(['x'])
  })
})
