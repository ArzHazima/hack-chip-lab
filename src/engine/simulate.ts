// Combinational simulation: validate the circuit, then evaluate chips in
// topological order (a chip runs only after every chip feeding it has run).

import { CHIPS, mask } from './chips'
import { describeEndpoint, isChipEndpoint, type Circuit, type Endpoint } from './circuit'

/** Thrown for any user-fixable circuit problem. `errors` has one message per problem. */
export class CircuitError extends Error {
  errors: string[]
  constructor(errors: string[]) {
    super(errors.join('\n'))
    this.name = 'CircuitError'
    this.errors = errors
  }
}

export interface SimResult {
  outputs: Record<string, number> // by circuit output pin NAME
  wireValues: Record<string, number> // by wire id (for coloring wires in the UI)
}

const key = (e: Endpoint): string => (isChipEndpoint(e) ? `${e.chip}.${e.pin}` : `#${e.pin}`)

/** Width of an endpoint, or undefined if it does not exist / is used in the wrong direction. */
function endpointWidth(c: Circuit, e: Endpoint, role: 'source' | 'target'): number | undefined {
  if (isChipEndpoint(e)) {
    const inst = c.chips.find((x) => x.id === e.chip)
    const def = inst && CHIPS[inst.type]
    if (!def) return undefined
    const pins = role === 'source' ? def.outputs : def.inputs
    return pins.find((p) => p.name === e.pin)?.width
  }
  const pin = c.pins.find((p) => p.id === e.pin)
  // A circuit INPUT pin drives wires (source); a circuit OUTPUT pin receives them (target).
  if (!pin || pin.kind !== (role === 'source' ? 'input' : 'output')) return undefined
  return pin.width
}

/** Returns every problem found (empty array = valid; cycles are detected in simulate). */
export function validateCircuit(c: Circuit): string[] {
  const errors: string[] = []

  for (const inst of c.chips) {
    if (!CHIPS[inst.type]) errors.push(`Unknown chip type "${inst.type}" (${inst.id})`)
  }

  const driven = new Set<string>()
  for (const w of c.wires) {
    const sw = endpointWidth(c, w.from, 'source')
    const tw = endpointWidth(c, w.to, 'target')
    const label = `${describeEndpoint(c, w.from)} → ${describeEndpoint(c, w.to)}`
    if (sw === undefined || tw === undefined) {
      errors.push(`Invalid wire ${label}: endpoint is missing or used in the wrong direction`)
      continue
    }
    if (sw !== tw) errors.push(`Width mismatch on wire ${label}: ${sw} bit(s) → ${tw} bit(s)`)
    const k = key(w.to)
    if (driven.has(k)) errors.push(`${describeEndpoint(c, w.to)} is driven by more than one wire`)
    driven.add(k)
  }

  // Every chip input and every circuit output must be driven.
  for (const inst of c.chips) {
    for (const p of CHIPS[inst.type]?.inputs ?? []) {
      if (!driven.has(`${inst.id}.${p.name}`)) {
        errors.push(`Unconnected input pin: ${inst.id}.${p.name}`)
      }
    }
  }
  for (const pin of c.pins) {
    if (pin.kind === 'output' && !driven.has(`#${pin.id}`)) {
      errors.push(`Unconnected output pin: "${pin.name}"`)
    }
  }
  return errors
}

/** Evaluate the circuit for the given input values (keyed by input pin name). */
export function simulate(c: Circuit, inputs: Record<string, number>): SimResult {
  const errors = validateCircuit(c)
  if (errors.length) throw new CircuitError(errors)

  // --- topological order (Kahn's algorithm) ---
  // indegree[chip] = number of wires coming from OTHER chips.
  const indegree = new Map<string, number>(c.chips.map((x) => [x.id, 0]))
  const downstream = new Map<string, string[]>()
  for (const w of c.wires) {
    if (isChipEndpoint(w.from) && isChipEndpoint(w.to)) {
      indegree.set(w.to.chip, (indegree.get(w.to.chip) ?? 0) + 1)
      downstream.set(w.from.chip, [...(downstream.get(w.from.chip) ?? []), w.to.chip])
    }
  }
  const queue = c.chips.filter((x) => indegree.get(x.id) === 0).map((x) => x.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const next of downstream.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  if (order.length < c.chips.length) {
    const stuck = c.chips.filter((x) => !order.includes(x.id)).map((x) => x.id)
    throw new CircuitError([`Cycle detected (feedback loop) involving: ${stuck.join(', ')}`])
  }

  // --- evaluation: `values` maps source endpoint key -> value ---
  const values = new Map<string, number>()
  for (const pin of c.pins.filter((p) => p.kind === 'input')) {
    const v = inputs[pin.name]
    if (v === undefined) throw new CircuitError([`No value given for input pin "${pin.name}"`])
    values.set(`#${pin.id}`, mask(v, pin.width))
  }
  const wireInto = new Map(c.wires.map((w) => [key(w.to), w]))
  for (const id of order) {
    const def = CHIPS[c.chips.find((x) => x.id === id)!.type]
    const inp: Record<string, number> = {}
    for (const p of def.inputs) inp[p.name] = values.get(key(wireInto.get(`${id}.${p.name}`)!.from))!
    const out = def.eval(inp)
    for (const p of def.outputs) values.set(`${id}.${p.name}`, mask(out[p.name], p.width))
  }

  const outputs: Record<string, number> = {}
  for (const pin of c.pins.filter((p) => p.kind === 'output')) {
    outputs[pin.name] = values.get(key(wireInto.get(`#${pin.id}`)!.from))!
  }
  const wireValues: Record<string, number> = {}
  for (const w of c.wires) wireValues[w.id] = values.get(key(w.from))!
  return { outputs, wireValues }
}
