import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCircuit, saveCircuit, type SavedCircuit } from './storage'

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
