// Circuit model: plain serializable data (so React state / localStorage can hold it)
// plus small helper functions that return NEW circuits (immutable style).

export interface CircuitPin {
  id: string
  name: string // matched against .cmp column names
  kind: 'input' | 'output'
  width: number
}

export interface ChipInstance {
  id: string
  type: string // key into CHIPS
}

/**
 * One end of a wire.
 * - { pin: id }             a circuit-level input/output pin
 * - { chip: id, pin: name } a pin of a chip instance
 * A wire goes from a *source* (circuit input or chip output) to a *target*
 * (chip input or circuit output).
 */
export type Endpoint = { pin: string } | { chip: string; pin: string }

export interface Wire {
  id: string
  from: Endpoint
  to: Endpoint
}

export interface Circuit {
  pins: CircuitPin[]
  chips: ChipInstance[]
  wires: Wire[]
}

export const emptyCircuit = (): Circuit => ({ pins: [], chips: [], wires: [] })

export const addPin = (
  c: Circuit,
  id: string,
  name: string,
  kind: 'input' | 'output',
  width = 1,
): Circuit => ({ ...c, pins: [...c.pins, { id, name, kind, width }] })

export const addChip = (c: Circuit, id: string, type: string): Circuit => ({
  ...c,
  chips: [...c.chips, { id, type }],
})

export const connect = (c: Circuit, from: Endpoint, to: Endpoint): Circuit => ({
  ...c,
  wires: [...c.wires, { id: `w${c.wires.length + 1}`, from, to }],
})

export const isChipEndpoint = (e: Endpoint): e is { chip: string; pin: string } => 'chip' in e

/** Human-readable endpoint name for error messages, e.g. `xor1.a` or `pin "out"`. */
export function describeEndpoint(c: Circuit, e: Endpoint): string {
  if (isChipEndpoint(e)) return `${e.chip}.${e.pin}`
  const pin = c.pins.find((p) => p.id === e.pin)
  return `pin "${pin?.name ?? e.pin}"`
}
