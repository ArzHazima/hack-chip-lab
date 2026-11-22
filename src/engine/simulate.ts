// Combinational simulation: validate the circuit, then evaluate chips in
// topological order (a chip runs only after every chip feeding it has run).

import { busErrors, isBusType } from './bus'
import { MAX_WIDTH, mask, type ChipDef } from './chips'
import { chipOf } from './resolve'
import { describeEndpoint, isChipEndpoint, type ChipInstance, type Circuit, type CircuitPin, type Endpoint } from './circuit'

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
  chipInputs: Record<string, Record<string, number>> // what each chip instance received
}

const key = (e: Endpoint): string => (isChipEndpoint(e) ? `${e.chip}.${e.pin}` : `#${e.pin}`)

/**
 * Width of an endpoint, or undefined if it does not exist / is used in the wrong direction.
 * `defs` and `pins` are lookup tables built once per validation (O(1) per wire).
 */
function endpointWidth(
  defs: Map<string, ChipDef | undefined>,
  pins: Map<string, CircuitPin>,
  e: Endpoint,
  role: 'source' | 'target',
): number | undefined {
  if (isChipEndpoint(e)) {
    const def = defs.get(e.chip)
    if (!def) return undefined
    return (role === 'source' ? def.outputs : def.inputs).find((p) => p.name === e.pin)?.width
  }
  const pin = pins.get(e.pin)
  // A circuit INPUT pin drives wires (source); a circuit OUTPUT pin receives them (target).
  if (!pin || pin.kind !== (role === 'source' ? 'input' : 'output')) return undefined
  return pin.width
}

/**
 * Returns every problem found (empty array = valid; cycles are detected in planOrder).
 * Cost is O(C + W + P): chips and pins are looked up in Maps, and error text is only
 * built when there actually is an error.
 */
export function validateCircuit(c: Circuit): string[] {
  const errors: string[] = []

  // One definition per chip instance, built once (chipOf rebuilds Split/Join pins on each call).
  const defs = new Map<string, ChipDef | undefined>()
  for (const inst of c.chips) {
    defs.set(inst.id, chipOf(inst))
    if (!defs.get(inst.id)) errors.push(`Unknown chip type "${inst.type}" (${inst.id})`)
    // Split / Join / Const settings: ranges inside the bus, no overlaps on a Join, no undriven bits.
    if (isBusType(inst.type)) errors.push(...busErrors(inst.id, inst.type, inst.params))
  }
  const pins = new Map(c.pins.map((p) => [p.id, p]))
  for (const p of c.pins) {
    if (!Number.isInteger(p.width) || p.width < 1 || p.width > MAX_WIDTH) {
      errors.push(`Pin "${p.name}" is ${p.width} bits wide; the maximum is ${MAX_WIDTH}`)
    }
  }

  const driven = new Set<string>()
  for (const w of c.wires) {
    const sw = endpointWidth(defs, pins, w.from, 'source')
    const tw = endpointWidth(defs, pins, w.to, 'target')
    if (sw === undefined || tw === undefined) {
      const label = `${describeEndpoint(c, w.from)} → ${describeEndpoint(c, w.to)}`
      errors.push(`Invalid wire ${label}: endpoint is missing or used in the wrong direction`)
      continue
    }
    if (sw !== tw) {
      const label = `${describeEndpoint(c, w.from)} → ${describeEndpoint(c, w.to)}`
      errors.push(`Width mismatch on wire ${label}: ${sw} bit(s) → ${tw} bit(s)`)
    }
    const k = key(w.to)
    if (driven.has(k)) errors.push(`${describeEndpoint(c, w.to)} is driven by more than one wire`)
    driven.add(k)
  }

  // Every chip input and every circuit output must be driven.
  for (const inst of c.chips) {
    for (const p of defs.get(inst.id)?.inputs ?? []) {
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

/** Per-instance state of every sequential chip, keyed by chip id. */
export type ChipStates = Map<string, unknown>

function stateOf(states: ChipStates, inst: ChipInstance): unknown {
  if (!states.has(inst.id)) states.set(inst.id, chipOf(inst)!.seq!.init()) // created on first use
  return states.get(inst.id)
}

/** True if the circuit contains at least one clocked chip (DFF, RAM, PC ...). */
export const hasSequential = (c: Circuit): boolean => c.chips.some((x) => chipOf(x)?.seq)

/**
 * Validates the circuit and returns the order in which its chips must be evaluated.
 *
 * Ordering is a topological sort (Kahn's algorithm). A wire u → v means "u before v",
 * EXCEPT when u is a *registered* chip (DFF, PC): its output comes from stored state,
 * not from this cycle's inputs, so it can be computed first. That is exactly what makes
 * a feedback loop legal if (and only if) it passes through such a chip.
 */
export function planOrder(c: Circuit): string[] {
  const errors = validateCircuit(c)
  if (errors.length) throw new CircuitError(errors)
  return orderChips(c)
}

/**
 * The ordering step of planOrder, for callers that have ALREADY validated the circuit
 * (runTests validates once, together with the .cmp columns, then plans once).
 * Throws CircuitError on a feedback loop that does not pass through a DFF/PC.
 */
export function orderChips(c: Circuit): string[] {
  const registered = new Map(c.chips.map((x) => [x.id, !!chipOf(x)?.seq?.registered]))
  const indegree = new Map<string, number>(c.chips.map((x) => [x.id, 0]))
  const downstream = new Map<string, string[]>()
  for (const w of c.wires) {
    if (!isChipEndpoint(w.from) || !isChipEndpoint(w.to)) continue
    if (registered.get(w.from.chip)) continue // breaks the dependency
    indegree.set(w.to.chip, (indegree.get(w.to.chip) ?? 0) + 1)
    downstream.set(w.from.chip, [...(downstream.get(w.from.chip) ?? []), w.to.chip])
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
    throw new CircuitError([
      `Cycle detected (feedback loop) involving: ${stuck.join(', ')}. ` +
        'A loop is only allowed if it passes through a DFF (or PC).',
    ])
  }
  return order
}

/**
 * Evaluate chips in `order` for the given inputs, reading (never changing) `states`.
 * `chipInputs` reports what every chip saw, which the Simulator needs for `tick`.
 */
export function evaluate(
  c: Circuit,
  order: string[],
  inputs: Record<string, number>,
  states: ChipStates,
): SimResult {
  const values = new Map<string, number>() // source endpoint key -> value
  for (const pin of c.pins.filter((p) => p.kind === 'input')) {
    const v = inputs[pin.name]
    if (v === undefined) throw new CircuitError([`No value given for input pin "${pin.name}"`])
    values.set(`#${pin.id}`, mask(v, pin.width))
  }

  // Registered chips: outputs are known before anything else is computed.
  for (const inst of c.chips) {
    const def = chipOf(inst)!
    if (!def.seq?.registered) continue
    const out = def.seq.read({}, stateOf(states, inst))
    for (const p of def.outputs) values.set(`${inst.id}.${p.name}`, mask(out[p.name], p.width))
  }

  const wireInto = new Map(c.wires.map((w) => [key(w.to), w]))
  const instOf = new Map(c.chips.map((x) => [x.id, x]))
  const chipInputs: Record<string, Record<string, number>> = {}
  for (const id of order) {
    const inst = instOf.get(id)!
    const def = chipOf(inst)!
    const inp: Record<string, number> = {}
    for (const p of def.inputs) inp[p.name] = values.get(key(wireInto.get(`${id}.${p.name}`)!.from))!
    chipInputs[id] = inp
    if (def.seq?.registered) continue // outputs already set
    const out = def.seq ? def.seq.read(inp, stateOf(states, inst)) : def.eval(inp)
    for (const p of def.outputs) values.set(`${id}.${p.name}`, mask(out[p.name], p.width))
  }

  const outputs: Record<string, number> = {}
  for (const pin of c.pins.filter((p) => p.kind === 'output')) {
    outputs[pin.name] = values.get(key(wireInto.get(`#${pin.id}`)!.from))!
  }
  const wireValues: Record<string, number> = {}
  for (const w of c.wires) wireValues[w.id] = values.get(key(w.from))!
  return { outputs, wireValues, chipInputs }
}

/**
 * Evaluate a circuit once with fresh state (sequential chips start at 0).
 * Use `Simulator` (sequential.ts) when state must persist between clock cycles.
 */
export function simulate(c: Circuit, inputs: Record<string, number>): SimResult {
  return evaluate(c, planOrder(c), inputs, new Map())
}
