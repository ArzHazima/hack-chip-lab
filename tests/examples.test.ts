// The bundled example chips (public/examples/): loaded through the same path as a picked folder
// (fetchExampleFiles → readExerciseFiles → groupExerciseFiles), then one of them is run.

import { describe, expect, it } from 'vitest'
import { groupExerciseFiles, runExercise } from '../src/engine/exercise'
import { parseHdlInterface } from '../src/engine/hdl'
import { fetchExampleFiles, readExerciseFiles } from '../src/ui/fileLoading'
import { pinsFromInterface } from '../src/ui/exercisePins'
import { flowToCircuit } from '../src/ui/flowToCircuit'

// A fake `fetch` that serves public/ from disk and records the URLs, so no server is needed.
const served = import.meta.glob('../public/examples/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const urls: string[] = []
const fakeFetch = (async (url: string) => {
  urls.push(url)
  const text = served[`../public/${url.slice(url.indexOf('examples/'))}`] // drop the base ("/" or "/hack-chip-lab/")
  return text === undefined ? new Response('nope', { status: 404 }) : new Response(text)
}) as unknown as typeof fetch

describe('bundled example chips', () => {
  it('loads Mirror16, Pick4of16, Wide16And and WriteOnceRAM8, each with hdl + tst + cmp', async () => {
    const files = await fetchExampleFiles('/hack-chip-lab/', fakeFetch)
    expect(urls.every((u) => u.startsWith('/hack-chip-lab/examples/'))).toBe(true) // works under a sub-path
    const read = await readExerciseFiles(files)
    expect(read.warnings).toEqual([])
    const chips = groupExerciseFiles(read.files)
    expect(chips.map((c) => c.name).sort()).toEqual(['Mirror16', 'Pick4of16', 'Wide16And', 'WriteOnceRAM8'])
    for (const c of chips) expect([c.hdl, c.tst, c.cmp].every(Boolean)).toBe(true)
  })

  it('Mirror16 (bit reversal, built with Split + Join) passes its own test', async () => {
    const read = await readExerciseFiles(await fetchExampleFiles('/', fakeFetch))
    const chip = groupExerciseFiles(read.files).find((c) => c.name === 'Mirror16')!
    let n = 1
    const nodes = pinsFromInterface(parseHdlInterface(chip.hdl!.text), () => n++)
    const id = (name: string) => nodes.find((x) => x.type !== 'chip' && x.data.name === name)!.id
    nodes.push(
      { id: 'sp', type: 'chip', position: { x: 0, y: 0 }, data: { type: 'Split', params: { width: 16 } } },
      { id: 'jn', type: 'chip', position: { x: 0, y: 0 }, data: { type: 'Join', params: { width: 16 } } },
    )
    const edges = [
      { id: 'a', source: id('in'), sourceHandle: 'out', target: 'sp', targetHandle: 'in' },
      { id: 'b', source: 'jn', sourceHandle: 'out', target: id('out'), targetHandle: 'in' },
      ...Array.from({ length: 16 }, (_, i) => ({ id: `w${i}`, source: 'sp', sourceHandle: `[${i}]`, target: 'jn', targetHandle: `[${15 - i}]` })),
    ]
    const { circuit, errors } = flowToCircuit(nodes, edges)
    expect(errors).toEqual([])
    const result = runExercise(circuit, chip.tst!.text, chip.cmp!.text)
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every((r) => r.pass)).toBe(true)
  })

  it('reports a missing file clearly', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(fetchExampleFiles('/nowhere/', notFound)).rejects.toThrow(/HTTP 404/)
  })
})
