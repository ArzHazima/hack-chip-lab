// The course's memory chips as built-ins: Bit, Register, ARegister, DRegister, RAM8 (plus the
// ones that already existed). Same clock model everywhere: tick samples, tock commits.

import { describe, expect, it } from 'vitest'
import { CHIP_GROUPS, CHIPS } from './chips'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { Simulator } from './sequential'

/** A circuit that contains just one chip, every pin wired to a circuit pin of the same name. */
function single(type: string): Circuit {
  const def = CHIPS[type]
  let c = emptyCircuit()
  c = addChip(c, 'u', type)
  for (const p of def.inputs) {
    c = addPin(c, p.name, p.name, 'input', p.width)
    c = connect(c, { pin: p.name }, { chip: 'u', pin: p.name })
  }
  for (const p of def.outputs) {
    c = addPin(c, `o_${p.name}`, p.name, 'output', p.width)
    c = connect(c, { chip: 'u', pin: p.name }, { pin: `o_${p.name}` })
  }
  return c
}

describe('the sidebar "Memory" section', () => {
  const memory = CHIP_GROUPS.find((g) => g.title.includes('Memory'))

  it('exists and lists every memory chip of the course (and nothing is listed twice)', () => {
    expect(memory).toBeDefined()
    const required = ['DFF', 'Bit', 'Register', 'ARegister', 'DRegister', 'RAM8', 'RAM64', 'RAM512', 'RAM4K', 'RAM16K', 'PC']
    for (const name of required) expect(memory!.chips, name).toContain(name)
    expect(new Set(memory!.chips).size).toBe(memory!.chips.length)
    const all = CHIP_GROUPS.flatMap((g) => g.chips)
    expect(new Set(all).size).toBe(all.length) // each chip is in exactly one section
  })

  it('every chip named there really exists and is clocked', () => {
    for (const name of memory!.chips) {
      expect(CHIPS[name], name).toBeDefined()
      expect(CHIPS[name].seq, `${name} should be clocked`).toBeDefined()
    }
  })
})

describe('pins, as in the course', () => {
  const pins = (type: string) => {
    const f = (ps: { name: string; width: number }[]) => ps.map((p) => `${p.name}[${p.width}]`).join(' ')
    return `${f(CHIPS[type].inputs)} -> ${f(CHIPS[type].outputs)}`
  }

  it('Bit, Register, ARegister, DRegister', () => {
    expect(pins('Bit')).toBe('in[1] load[1] -> out[1]')
    for (const t of ['Register', 'ARegister', 'DRegister']) expect(pins(t)).toBe('in[16] load[1] -> out[16]')
  })

  it('RAM8 .. RAM16K differ only in the address width', () => {
    const widths: Record<string, number> = { RAM8: 3, RAM64: 6, RAM512: 9, RAM4K: 12, RAM16K: 14 }
    for (const [t, w] of Object.entries(widths)) expect(pins(t), t).toBe(`in[16] load[1] address[${w}] -> out[16]`)
  })
})

describe('Bit', () => {
  it('out(t+1) = load ? in : out, visible only after the tock', () => {
    const sim = new Simulator(single('Bit'))
    expect(sim.eval({ in: 1, load: 1 }).outputs.out).toBe(0) // nothing stored yet
    expect(sim.tick({ in: 1, load: 1 }).outputs.out).toBe(0) // tick: sampled, not visible yet
    expect(sim.tock({ in: 1, load: 1 }).outputs.out).toBe(1) // tock: now visible
    expect(sim.step({ in: 0, load: 0 }).outputs.out).toBe(1) // load = 0 keeps the value
    expect(sim.step({ in: 0, load: 1 }).outputs.out).toBe(0) // load = 1 writes the new value
  })

  it('shows its stored value for the live "stored" badge', () => {
    const sim = new Simulator(single('Bit'))
    sim.step({ in: 1, load: 1 })
    expect(sim.stored()).toEqual({ u: 1 })
  })
})

describe.each(['Register', 'ARegister', 'DRegister'])('%s (16-bit)', (type) => {
  it('write then read back; load = 0 keeps the value; a new write replaces it', () => {
    const sim = new Simulator(single(type))
    expect(sim.step({ in: 12345, load: 1 }).outputs.out).toBe(12345)
    expect(sim.step({ in: 999, load: 0 }).outputs.out).toBe(12345)
    expect(sim.step({ in: 0xffff, load: 1 }).outputs.out).toBe(0xffff)
    expect(sim.step({ in: 0, load: 1 }).outputs.out).toBe(0)
  })

  it('the tick samples but the output changes only at the tock', () => {
    const sim = new Simulator(single(type))
    sim.step({ in: 7, load: 1 })
    expect(sim.tick({ in: 9, load: 1 }).outputs.out).toBe(7)
    expect(sim.tock({ in: 9, load: 1 }).outputs.out).toBe(9)
  })

  it('values are masked to 16 bits (also when the chip is used directly)', () => {
    // a 16-bit pin masks on the wire ...
    expect(new Simulator(single(type)).step({ in: 70000, load: 1 }).outputs.out).toBe(70000 - 65536)
    // ... and the chip itself never stores more than 16 bits, even for a raw value
    const seq = CHIPS[type].seq!
    const state = seq.init()
    seq.tick({ in: 70000, load: 1 }, state)
    seq.tock(state)
    expect(seq.read({}, state).out).toBe(4464)
    expect(seq.stored!(state)).toBe(4464)
  })

  it('starts at 0 and Reset of the simulator clears it', () => {
    const sim = new Simulator(single(type))
    expect(sim.eval({ in: 5, load: 0 }).outputs.out).toBe(0)
    sim.step({ in: 5, load: 1 })
    sim.reset()
    expect(sim.eval({ in: 5, load: 0 }).outputs.out).toBe(0)
  })
})

describe('RAM8', () => {
  const inp = (address: number, v = 0, load = 0) => ({ in: v, load, address })

  it('write then read back, all 8 addresses are independent', () => {
    const sim = new Simulator(single('RAM8'))
    for (let a = 0; a < 8; a++) sim.step(inp(a, 1000 + a, 1))
    for (let a = 0; a < 8; a++) expect(sim.eval(inp(a)).outputs.out, `address ${a}`).toBe(1000 + a)
  })

  it('load = 0 keeps the value; load = 1 replaces only that address', () => {
    const sim = new Simulator(single('RAM8'))
    sim.step(inp(3, 42, 1))
    sim.step(inp(3, 99, 0)) // load = 0: no write
    expect(sim.eval(inp(3)).outputs.out).toBe(42)
    sim.step(inp(3, 7, 1))
    sim.step(inp(4, 8, 1))
    expect(sim.eval(inp(3)).outputs.out).toBe(7)
    expect(sim.eval(inp(4)).outputs.out).toBe(8)
    expect(sim.eval(inp(5)).outputs.out).toBe(0)
  })

  it('a write becomes visible only at the tock', () => {
    const sim = new Simulator(single('RAM8'))
    expect(sim.tick(inp(2, 5, 1)).outputs.out).toBe(0)
    expect(sim.tock(inp(2, 5, 1)).outputs.out).toBe(5)
  })

  it('values are masked to 16 bits and the address to 3 bits', () => {
    const sim = new Simulator(single('RAM8'))
    sim.step(inp(1, 70000, 1))
    expect(sim.eval(inp(1)).outputs.out).toBe(4464)
    expect(sim.eval(inp(9)).outputs.out).toBe(4464) // address 9 on a 3-bit pin is address 1
    const seq = CHIPS.RAM8.seq!
    const state = seq.init()
    seq.tick({ in: 70000, load: 1, address: 6 }, state)
    seq.tock(state)
    expect(seq.read({ address: 6 }, state).out).toBe(4464)
    expect(seq.read({ address: 5 }, state).out).toBe(0)
  })

  it('is not "registered" (it reads the address combinationally), like the bigger RAM chips', () => {
    expect(CHIPS.RAM8.seq!.registered).toBe(false)
    for (const t of ['Bit', 'Register', 'ARegister', 'DRegister']) expect(CHIPS[t].seq!.registered, t).toBe(true)
  })
})
