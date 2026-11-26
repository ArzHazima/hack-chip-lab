// Combinational simulation: validate the circuit, then evaluate chips in
// topological order (a chip runs only after every chip feeding it has run).

import { busErrors, isBusType } from './bus'
import { MAX_WIDTH, mask, outputDeps, type ChipDef } from './chips'
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

/** The state of a clocked chip instance; created (from the instance, e.g. its ROM program) on first use. */
export function stateOf(states: ChipStates, inst: ChipInstance): unknown {
  if (!states.has(inst.id)) states.set(inst.id, chipOf(inst)!.seq!.init(inst))
  return states.get(inst.id)
}

/** True if the circuit contains at least one clocked chip (DFF, RAM, PC ...). */
export const hasSequential = (c: Circuit): boolean => c.chips.some((x) => chipOf(x)?.seq)

/**
 * One step of the evaluation order. An ordinary chip is one step (`outputs` / `deps` undefined = all of it).
 * A clocked chip is one step per GROUP of outputs that share the same dependencies (see `SeqBehavior.deps`):
 * the step computes only `outputs`, from only the inputs in `deps`.
 */
export interface PlanStep {
  chip: string
  outputs?: readonly string[]
  deps?: readonly string[]
}

/** The steps a chip is made of: one, unless it is a clocked chip whose outputs have different dependencies. */
function stepsOf(inst: ChipInstance): PlanStep[] {
  const def = chipOf(inst)
  const seq = def?.seq
  if (!def || !seq) return [{ chip: inst.id }]
  const groups = new Map<string, { outputs: string[]; deps: readonly string[] }>()
  for (const o of def.outputs) {
    const deps = outputDeps(seq, o.name)
    const k = [...deps].sort().join('|')
    const g = groups.get(k) ?? { outputs: [], deps }
    g.outputs.push(o.name)
    groups.set(k, g)
  }
  return [...groups.values()].map((g) => ({ chip: inst.id, outputs: g.outputs, deps: g.deps }))
}

/**
 * Validates the circuit and returns the order in which its chips must be evaluated.
 *
 * Ordering is a topological sort (Kahn's algorithm) over STEPS. A wire u.o → v.pin means "the step of u that
 * produces o runs before every step of v that depends on pin". For a clocked chip, `pin` creates a dependency
 * only if some output depends on it (`SeqBehavior.deps`, default `combInputs`): every other input is only sampled
 * at the clock tick, so it affects no output right now. That is exactly what makes a feedback loop legal if (and
 * only if) it enters a clocked chip through an input that its outputs do not depend on (DFF/Register/PC in, load ...;
 * RAM in, load; a CPU's inM matters only for outM, so ROM.out → CPU → ROM.address through pc is a normal fetch loop).
 * A loop through RAM.address (RAM.out depends on it immediately) is still a cycle.
 */
export function planOrder(c: Circuit): PlanStep[] {
  const errors = validateCircuit(c)
  if (errors.length) throw new CircuitError(errors)
  return orderChips(c)
}

/**
 * The ordering step of planOrder, for callers that have ALREADY validated the circuit
 * (runTests validates once, together with the .cmp columns, then plans once).
 * Throws CircuitError on a feedback loop that is purely combinational.
 */
export function orderChips(c: Circuit): PlanStep[] {
  // Nodes of the graph = steps. Key = chip id, plus "\0<n>" for the n-th group of a chip split into several.
  const steps = new Map<string, PlanStep>()
  const stepsByChip = new Map<string, { key: string; step: PlanStep }[]>()
  for (const x of c.chips) {
    const list = stepsOf(x).map((step, i, all) => ({ key: all.length === 1 ? x.id : `${x.id}\u0000${i}`, step }))
    stepsByChip.set(x.id, list)
    for (const { key: k, step } of list) steps.set(k, step)
  }
  const indegree = new Map<string, number>([...steps.keys()].map((k) => [k, 0]))
  const downstream = new Map<string, string[]>()
  for (const w of c.wires) {
    if (!isChipEndpoint(w.from) || !isChipEndpoint(w.to)) continue
    const srcPin = w.from.pin
    const from = (stepsByChip.get(w.from.chip) ?? []).find((s) => !s.step.outputs || s.step.outputs.includes(srcPin))
    if (!from) continue
    for (const to of stepsByChip.get(w.to.chip) ?? []) {
      // A clocked chip's step depends on a pin only if its group lists it (other pins are sampled at the tick).
      if (to.step.deps && !to.step.deps.includes(w.to.pin)) continue
      indegree.set(to.key, (indegree.get(to.key) ?? 0) + 1)
      downstream.set(from.key, [...(downstream.get(from.key) ?? []), to.key])
    }
  }
  const queue = [...steps.keys()].filter((k) => indegree.get(k) === 0)
  const order: PlanStep[] = []
  const done = new Set<string>()
  while (queue.length) {
    const k = queue.shift()!
    order.push(steps.get(k)!)
    done.add(k)
    for (const next of downstream.get(k) ?? []) {
      indegree.set(next, indegree.get(next)! - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  if (order.length < steps.size) {
    const stuck = [...new Set([...steps].filter(([k]) => !done.has(k)).map(([, s]) => s.chip))]
    throw new CircuitError([
      `Cycle detected (feedback loop) involving: ${stuck.join(', ')}. ` +
        'A loop is only allowed if it enters a clocked chip (DFF, Bit, Register, PC, RAM) through an input that is ' +
        'only sampled at the clock (in, load, inc, reset), not through a RAM address.',
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
  order: PlanStep[],
  inputs: Record<string, number>,
  states: ChipStates,
): SimResult {
  const values = new Map<string, number>() // source endpoint key -> value
  for (const pin of c.pins.filter((p) => p.kind === 'input')) {
    const v = inputs[pin.name]
    if (v === undefined) throw new CircuitError([`No value given for input pin "${pin.name}"`])
    values.set(`#${pin.id}`, mask(v, pin.width))
  }

  const wireInto = new Map(c.wires.map((w) => [key(w.to), w]))
  const instOf = new Map(c.chips.map((x) => [x.id, x]))
  const chipInputs: Record<string, Record<string, number>> = {}
  const clocked = new Set<string>() // sequential chips: their sampled inputs are read after everything settled
  for (const step of order) {
    const id = step.chip
    const inst = instOf.get(id)!
    const def = chipOf(inst)!
    const inp: Record<string, number> = {}
    if (def.seq) {
      // Only the inputs this group of outputs depends on (RAM address, a CPU's inM ...) are ready now; the others
      // (in / load ...) may still depend on this very chip further down the loop. They are read below, once all
      // values are known.
      for (const name of step.deps!) inp[name] = values.get(key(wireInto.get(`${id}.${name}`)!.from))!
      const out = def.seq.read(inp, stateOf(states, inst))
      for (const name of step.outputs!) {
        const p = def.outputs.find((o) => o.name === name)!
        values.set(`${id}.${name}`, mask(out[name], p.width))
      }
      clocked.add(id)
    } else {
      for (const p of def.inputs) inp[p.name] = values.get(key(wireInto.get(`${id}.${p.name}`)!.from))!
      chipInputs[id] = inp
      const out = def.eval(inp)
      for (const p of def.outputs) values.set(`${id}.${p.name}`, mask(out[p.name], p.width))
    }
  }
  // Everything has settled: what each clocked chip sees on ALL of its inputs (the Simulator latches this at tick).
  for (const id of clocked) {
    const inp: Record<string, number> = {}
    for (const p of chipOf(instOf.get(id)!)!.inputs) inp[p.name] = values.get(key(wireInto.get(`${id}.${p.name}`)!.from))!
    chipInputs[id] = inp
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
