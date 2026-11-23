import { afterEach, describe, expect, it, vi } from 'vitest'
import { chipSlot, getPref, loadCircuit, MANUAL_SLOT, saveCircuit, setPref, type SavedCircuit } from './storage'

const circuit: SavedCircuit = {
  nodes: [{ id: 'And1', type: 'chip', position: { x: 1, y: 2 }, data: { type: 'And' } }],
  edges: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('per-chip circuit storage', () => {
  it('works without localStorage at all (Node has none): no throw, nothing restored', () => {
    expect(() => saveCircuit('X', circuit)).not.toThrow()
    expect(loadCircuit('X')).toBeNull()
  })

  it('round-trips a circuit, keeping chips in separate slots', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    saveCircuit('A', circuit)
    expect(loadCircuit('A')).toEqual(circuit)
    expect(loadCircuit('B')).toBeNull()
  })

  it('survives a full or blocked storage and corrupt data', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{ not json',
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(() => saveCircuit('A', circuit)).not.toThrow()
    expect(loadCircuit('A')).toBeNull()
    vi.stubGlobal('localStorage', { getItem: () => '{"nodes":5}', setItem: () => {} })
    expect(loadCircuit('A')).toBeNull() // wrong shape is rejected, not trusted
  })
})

describe('storage slot of a chip identifies its interface', () => {
  const hdl = (text: string) => ({ name: 'Mux', hdl: { text } })
  const store = () => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    })
    return m
  }

  it('same name + same IN/OUT pins -> same slot, whatever PARTS says or how the file is formatted', () => {
    const a = chipSlot(hdl('CHIP Mux { IN a, b, sel; OUT out; PARTS: Not(in=a, out=x); }'))
    const b = chipSlot(hdl('// other implementation\nCHIP Mux {\n  IN sel,\n     b, a;   // order does not matter\n  OUT out;\n  PARTS: And(a=a, b=b, out=out);\n}'))
    expect(a).toBe(b)
    expect(a).toMatch(/^Mux#[0-9a-f]{8}$/)
  })

  it('same name but a different interface -> different slot (names, widths, IN vs OUT)', () => {
    const base = chipSlot(hdl('CHIP Mux { IN a, b, sel; OUT out; }'))
    expect(chipSlot(hdl('CHIP Mux { IN a[16], b[16], sel; OUT out[16]; }'))).not.toBe(base) // widths
    expect(chipSlot(hdl('CHIP Mux { IN a, b, sel; OUT o; }'))).not.toBe(base) // pin name
    expect(chipSlot(hdl('CHIP Mux { IN a, b; OUT sel, out; }'))).not.toBe(base) // same names, other direction
  })

  it('a circuit saved for one exercise is NOT restored for a same-named chip of another folder', () => {
    store()
    const mine: SavedCircuit = { nodes: [{ id: 'And1', type: 'chip', position: { x: 0, y: 0 }, data: { type: 'And' } }], edges: [] }
    const slotA = chipSlot(hdl('CHIP Mux { IN a, b, sel; OUT out; }'))
    const slotB = chipSlot(hdl('CHIP Mux { IN a[16], b[16], sel; OUT out[16]; }'))
    saveCircuit(slotA, mine)
    expect(loadCircuit(slotB)).toBeNull() // different interface: a fresh board
    expect(loadCircuit(slotA)).toEqual(mine) // same interface: restored
  })

  it('a chip without a readable .hdl gets a stable slot of its own', () => {
    expect(chipSlot({ name: 'X' })).toBe(chipSlot({ name: 'X' }))
    expect(chipSlot({ name: 'X' })).toBe('X#nohdl')
    expect(chipSlot({ name: 'X', hdl: { text: 'not hdl at all' } })).toBe('X#nohdl')
    expect(chipSlot({ name: 'X' })).not.toBe(chipSlot({ name: 'Y' }))
  })

  it('never collides with the manual board slot', () => {
    expect(chipSlot({ name: '__manual__' })).not.toBe(MANUAL_SLOT)
  })
})

describe('small preferences (format, help shown)', () => {
  it('work without localStorage (nothing remembered, nothing thrown)', () => {
    expect(() => setPref('format', 'hex')).not.toThrow()
    expect(getPref('format')).toBeNull()
  })

  it('are remembered per name', () => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) })
    setPref('format', 'hex')
    setPref('helpSeen', '1')
    expect(getPref('format')).toBe('hex')
    expect(getPref('helpSeen')).toBe('1')
    expect(getPref('other')).toBeNull()
  })

  it('a blocked storage (every call throws) never breaks the app', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(() => setPref('x', '1')).not.toThrow()
    expect(getPref('x')).toBeNull()
  })
})
