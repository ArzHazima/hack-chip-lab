// Stateful simulation: a Simulator owns the per-instance state of every sequential
// chip and advances the two-phase clock (tick, then tock).

import { CHIPS } from './chips'
import type { Circuit } from './circuit'
import { evaluate, planOrder, type ChipStates, type SimResult } from './simulate'

export class Simulator {
  private order: string[]
  private states: ChipStates = new Map() // chip id -> that instance's state
  private cycle = 0 // completed clock cycles
  private high = false // true between a tick and the following tock

  /** Throws CircuitError if the circuit is invalid (bad wires, loop without a DFF ...). */
  constructor(public readonly circuit: Circuit) {
    this.order = planOrder(circuit)
  }

  /**
   * Nand2Tetris-style time: "0" at the start, "0+" after the first tick,
   * "1" after the first tock, "1+" after the next tick, and so on.
   */
  get time(): string {
    return `${this.cycle}${this.high ? '+' : ''}`
  }

  get cycles(): number {
    return this.cycle
  }

  /** Settle the combinational logic for these inputs. Never changes stored state. */
  eval(inputs: Record<string, number>): SimResult {
    return evaluate(this.circuit, this.order, inputs, this.states)
  }

  /** Rising edge: every clocked chip samples its inputs; outputs do not change yet. */
  tick(inputs: Record<string, number>): SimResult {
    const result = this.eval(inputs)
    for (const inst of this.circuit.chips) {
      const seq = CHIPS[inst.type].seq
      if (seq) seq.tick(result.chipInputs[inst.id], this.states.get(inst.id))
    }
    this.high = true
    return result
  }

  /** Falling edge: sampled values become the stored state; one clock cycle completes. */
  tock(inputs: Record<string, number>): SimResult {
    if (this.high) {
      for (const inst of this.circuit.chips) {
        const seq = CHIPS[inst.type].seq
        if (seq) seq.tock(this.states.get(inst.id))
      }
      this.high = false
      this.cycle++
    } // a tock without a preceding tick does nothing
    return this.eval(inputs)
  }

  /** One full clock cycle: tick then tock. */
  step(inputs: Record<string, number>): SimResult {
    this.tick(inputs)
    return this.tock(inputs)
  }

  /** Forget all stored values and go back to time 0. */
  reset(): void {
    this.states.clear()
    this.cycle = 0
    this.high = false
  }

  /** Live stored value of each chip that has one (DFF bit, PC counter), by chip id. */
  stored(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const inst of this.circuit.chips) {
      const seq = CHIPS[inst.type].seq
      if (!seq?.stored) continue
      const v = seq.stored(this.states.has(inst.id) ? this.states.get(inst.id) : seq.init())
      if (v !== undefined) out[inst.id] = v
    }
    return out
  }
}
