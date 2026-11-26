// Stateful simulation: a Simulator owns the per-instance state of every sequential
// chip and advances the two-phase clock (tick, then tock).

import type { SeqBehavior } from './chips'
import { chipOf } from './resolve'
import type { Circuit } from './circuit'
import { evaluate, planOrder, stateOf, type ChipStates, type PlanStep, type SimResult } from './simulate'

export class Simulator {
  private order: PlanStep[]
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
      const seq = chipOf(inst)?.seq
      if (seq) seq.tick(result.chipInputs[inst.id], this.states.get(inst.id))
    }
    this.high = true
    return result
  }

  /** Falling edge: sampled values become the stored state; one clock cycle completes. */
  tock(inputs: Record<string, number>): SimResult {
    if (this.high) {
      for (const inst of this.circuit.chips) {
        const seq = chipOf(inst)?.seq
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

  /**
   * Back to time 0. Chips with a `reset` hook clear themselves IN PLACE (RAM / Screen / Memory keep their array;
   * ROM32K keeps its program and Keyboard its key: Reset clears the machine, not the program). The other clocked
   * chips are simply recreated on next use, i.e. back to 0.
   */
  reset(): void {
    for (const inst of this.circuit.chips) {
      const seq = chipOf(inst)?.seq
      if (!seq || !this.states.has(inst.id)) continue
      if (seq.reset) seq.reset(this.states.get(inst.id))
      else this.states.delete(inst.id)
    }
    this.cycle = 0
    this.high = false
  }

  /** Replace the program of every ROM32K in the circuit. Returns how many chips got it. */
  loadRom(words: ArrayLike<number>): number {
    return this.forEachWith('loadRom', (seq, st) => seq.loadRom!(st, words))
  }

  /**
   * Set the key that is held (0 = none) on every Keyboard and Memory chip, or only on `chipId`.
   * Returns how many chips got it.
   */
  setKeyboard(key: number, chipId?: string): number {
    return this.forEachWith('setKey', (seq, st) => seq.setKey!(st, key), chipId)
  }

  /** One stored word of a chip (`index` for memories), or undefined if the chip has no such thing. */
  peek(chipId: string, index?: number): number | undefined {
    const inst = this.circuit.chips.find((x) => x.id === chipId)
    const seq = inst && chipOf(inst)?.seq
    return inst && seq?.peek ? seq.peek(stateOf(this.states, inst), index) : undefined
  }

  /**
   * An internal register of a CPU or Computer: "A", "D" or "PC" (see `SeqBehavior.exposes`). Undefined for another
   * chip or name.
   */
  peekRegister(chipId: string, name: string): number | undefined {
    const inst = this.circuit.chips.find((x) => x.id === chipId)
    const seq = inst && chipOf(inst)?.seq
    return inst && seq?.peekReg ? seq.peekReg(stateOf(this.states, inst), name) : undefined
  }

  /** Set A, D or PC directly, without the clock (A and D keep 16 bits, PC 15). Unknown names are ignored. */
  pokeRegister(chipId: string, name: string, value: number): void {
    const inst = this.circuit.chips.find((x) => x.id === chipId)
    const seq = inst && chipOf(inst)?.seq
    if (inst && seq?.pokeReg) seq.pokeReg(stateOf(this.states, inst), name, value)
  }

  /** Write a stored word directly, without the clock. Ignored for chips without `poke` (ROM32K is read-only). */
  poke(chipId: string, index: number, value: number): void {
    const inst = this.circuit.chips.find((x) => x.id === chipId)
    const seq = inst && chipOf(inst)?.seq
    if (inst && seq?.poke) seq.poke(stateOf(this.states, inst), index, value)
  }

  /** Runs `action` on the state of every clocked chip that has the optional behaviour `method`; returns how many. */
  private forEachWith(method: keyof SeqBehavior, action: (seq: SeqBehavior, state: unknown) => void, onlyChip?: string): number {
    let n = 0
    for (const inst of this.circuit.chips) {
      if (onlyChip !== undefined && inst.id !== onlyChip) continue
      const seq = chipOf(inst)?.seq
      if (!seq || !seq[method]) continue
      action(seq, stateOf(this.states, inst))
      n++
    }
    return n
  }

  /** Live stored value of each chip that has one (DFF bit, PC counter), by chip id. */
  stored(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const inst of this.circuit.chips) {
      const seq = chipOf(inst)?.seq
      if (!seq?.stored) continue
      const v = seq.stored(this.states.has(inst.id) ? this.states.get(inst.id) : seq.init(inst))
      if (v !== undefined) out[inst.id] = v
    }
    return out
  }
}
