// Adversarial inputs found in the pre-publication security review. Each test used to hang,
// blow up memory or crash; now it must fail fast with a clear message (or load safely).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from '../src/engine/circuit'
import { parseHdlInterface } from '../src/engine/hdl'
import { parseTst, runTst } from '../src/engine/tst'
import { MAX_FILE_BYTES, MAX_FILES, readExerciseFiles } from '../src/ui/fileLoading'
import { clearSavedCircuits, loadCircuit } from '../src/ui/storage'

/** Toggle flip-flop: a small clocked circuit to run scripts on. */
function toggle(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'out', 'out', 'output')
  c = addChip(c, 'not', 'Not')
  c = addChip(c, 'dff', 'DFF')
  c = connect(c, { chip: 'dff', pin: 'out' }, { chip: 'not', pin: 'in' })
  c = connect(c, { chip: 'not', pin: 'out' }, { chip: 'dff', pin: 'in' })
  c = connect(c, { chip: 'dff', pin: 'out' }, { pin: 'out' })
  return c
}

/** Runs fn and returns how many milliseconds it took, plus the error it threw (if any). */
function timed(fn: () => unknown): { ms: number; error?: Error } {
  const t0 = performance.now()
  try {
    fn()
    return { ms: performance.now() - t0 }
  } catch (e) {
    return { ms: performance.now() - t0, error: e as Error }
  }
}

describe('item 1: .tst loops are bounded even when the body is empty', () => {
  it('repeat 99999999999 { } fails fast with a clear message', () => {
    const r = timed(() => runTst(toggle(), parseTst('repeat 99999999999 { }')))
    expect(r.error?.message).toMatch(/too long/)
    expect(r.ms).toBeLessThan(1000)
  })

  it('nested empty repeats (1000 x 1000 x 1000) fail fast', () => {
    const r = timed(() => runTst(toggle(), parseTst('repeat 1000 { repeat 1000 { repeat 1000 { } } }')))
    expect(r.error?.message).toMatch(/too long/)
    expect(r.ms).toBeLessThan(1000)
  })

  it('a deeply nested script is rejected by the parser (no stack overflow)', () => {
    const text = 'repeat 1 { '.repeat(5000) + '}'.repeat(5000)
    const r = timed(() => parseTst(text))
    expect(r.error?.message).toMatch(/nested too deeply/)
    expect(r.ms).toBeLessThan(1000)
  })

  it('normal nesting and a big-but-legal loop still work', () => {
    const t = parseTst('repeat 2 { repeat 2 { tick, tock; } } repeat 100000 { tick, tock; }')
    expect(() => runTst(toggle(), t)).not.toThrow()
  })
})

describe('item 2: .hdl parsing is linear', () => {
  it('300 KB of "IN IN IN ..." without ";" gives the missing-; error quickly', () => {
    const text = 'CHIP X { ' + 'IN '.repeat(100_000) + ' }'
    const r = timed(() => parseHdlInterface(text))
    expect(r.error?.message).toMatch(/missing its closing ";"/)
    expect(r.ms).toBeLessThan(1000)
  })

  it('300 KB of unterminated "/*" does not take quadratic time', () => {
    const text = 'CHIP X { IN a; OUT b; ' + '/* '.repeat(100_000)
    const r = timed(() => parseHdlInterface(text))
    expect(r.error).toBeUndefined()
    expect(r.ms).toBeLessThan(1000)
  })

  it('many OUT words without ";" are also fast', () => {
    const text = 'CHIP X { IN a; ' + 'OUT '.repeat(100_000) + ' }'
    const r = timed(() => parseHdlInterface(text))
    expect(r.error?.message).toMatch(/missing its closing ";"/)
    expect(r.ms).toBeLessThan(1000)
  })
})

describe('item 5: the number of output rows is capped', () => {
  it('repeat 900000 { output; } stops with a clear message', () => {
    const t = parseTst('output-list out%B1.1.1; repeat 900000 { output; }')
    const r = timed(() => runTst(toggle(), t))
    expect(r.error?.message).toMatch(/too many output rows/)
    expect(r.ms).toBeLessThan(3000)
  })
})

// ---------------------------------------------------------------------------
describe('item 3: saved circuits from localStorage are validated', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size
      },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  const put = (v: unknown) => store.set('hacklab:circuit:S', typeof v === 'string' ? v : JSON.stringify(v))
  const chip = (id: string, data: unknown, type: unknown = 'chip') => ({ id, type, position: { x: 1, y: 2 }, data })

  it('drops a node whose type is "constructor" / "toString" / "__proto__"', () => {
    put({
      nodes: [chip('a', { type: 'constructor' }), chip('b', { type: 'toString' }), chip('c', { type: '__proto__' }), chip('d', { type: 'And' })],
      edges: [],
    })
    expect(loadCircuit('S')?.nodes.map((n) => n.id)).toEqual(['d'])
  })

  it('loads garbage JSON and wrong shapes without throwing', () => {
    for (const bad of ['{ not json', 'null', '42', '"x"', '[]', '{}', '{"nodes":1,"edges":2}', '{"nodes":[],"edges":{}}']) {
      put(bad)
      expect(() => loadCircuit('S')).not.toThrow()
      expect(loadCircuit('S')).toBeNull()
    }
  })

  it('drops invalid items, keeps the valid ones, and drops wires of dropped nodes', () => {
    put({
      nodes: [
        chip('ok', { type: 'And' }),
        chip('ok2', { type: 'Not' }),
        null,
        7,
        'x',
        { id: 'nopos', type: 'chip', data: { type: 'And' } },
        { id: 'strpos', type: 'chip', position: { x: '1', y: 2 }, data: { type: 'And' } },
        { id: 'nan', type: 'chip', position: { x: 1e999, y: 2 }, data: { type: 'And' } },
        chip('weird', { type: 'And' }, 'script'),
        chip('pin1', { name: 'a', width: 99 }, 'inpin'),
        chip('pin2', { name: 'a', width: 4, value: 'x' }, 'inpin'),
        chip('badparams', { type: 'Split', params: { width: 'big' } }),
        chip('pin3', { name: 'a', width: 4, value: 3 }, 'inpin'),
      ],
      edges: [
        { id: 'e1', source: 'ok', target: 'ok2', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e2', source: 'ok', target: 'pin1' }, // pin1 was dropped
        { id: 'e3', source: 5, target: 'ok2' },
        { id: 'e4', source: 'ok', target: 'ok2', sourceHandle: { x: 1 } },
        'junk',
      ],
    })
    const c = loadCircuit('S')!
    expect(c.nodes.map((n) => n.id)).toEqual(['ok', 'ok2', 'pin3'])
    expect(c.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('an oversized saved circuit is ignored', () => {
    put({ nodes: Array.from({ length: 5000 }, (_, i) => chip(`n${i}`, { type: 'And' })), edges: [] })
    expect(loadCircuit('S')).toBeNull()
  })

  it('a circuit that is really saved still round-trips', () => {
    const good = {
      nodes: [
        chip('Split1', { type: 'Split', params: { width: 16, ranges: '0..7' }, ranges: [{ pin: 'in', lo: 0, hi: 3 }] }),
        chip('in1', { name: 'x', width: 16, inputValue: 5 }, 'inpin'),
        chip('out1', { name: 'y', width: 1 }, 'outpin'),
      ],
      edges: [{ id: 'e', source: 'in1', sourceHandle: 'out', target: 'Split1', targetHandle: 'in' }],
    }
    put(good)
    expect(loadCircuit('S')).toEqual(good)
  })

  it('clearSavedCircuits removes circuits but not preferences', () => {
    put({ nodes: [], edges: [] })
    store.set('hacklab:pref:format', 'bin')
    clearSavedCircuits()
    expect([...store.keys()]).toEqual(['hacklab:pref:format'])
  })
})

describe('item 4: file limits', () => {
  const file = (name: string, size = 10) => new File(['x'.repeat(size)], name)

  it('skips a file over 5 MB with a visible warning, keeps the others', async () => {
    const big = file('Big.hdl', MAX_FILE_BYTES + 1)
    const r = await readExerciseFiles([big, file('Small.hdl'), file('notes.txt')])
    expect(r.files.map((f) => f.name)).toEqual(['Small.hdl'])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/Big\.hdl.*limit/)
  })

  it('reads only the first 2,000 wanted files and says so', async () => {
    const files = Array.from({ length: 2500 }, (_, i) => file(`C${i}.hdl`))
    const r = await readExerciseFiles(files)
    expect(r.files).toHaveLength(MAX_FILES)
    expect(r.warnings[0]).toMatch(/Too many files: 2500/)
  })

  it('no warnings for a normal folder', async () => {
    const r = await readExerciseFiles([file('A.hdl'), file('A.tst'), file('A.cmp')])
    expect(r.files).toHaveLength(3)
    expect(r.warnings).toEqual([])
  })
})
