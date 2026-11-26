// Project 5 memory system: ROM32K, Screen, Keyboard, Memory, plus per-output dependencies in the planner.
import { afterAll, describe, expect, it } from 'vitest'
import { CHIP_GROUPS, CHIPS, mask, type ChipDef } from './chips'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { parseHack } from './hack'
import { Simulator } from './sequential'
import { CircuitError, planOrder } from './simulate'

/** One chip, every pin wired to a circuit pin of the same name (like memory.test.ts). */
function single(type: string, extra: { program?: number[]; key?: number } = {}): Circuit {
  const def = CHIPS[type]
  let c = emptyCircuit()
  c = addChip(c, 'u', type)
  c.chips[0] = { ...c.chips[0], ...extra }
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

describe('Project 5 sidebar section', () => {
  it('lists the four chips; each exists, is clocked and is listed once', () => {
    const g = CHIP_GROUPS.find((x) => x.title.startsWith('Project 5'))
    expect(g?.chips).toEqual(['ROM32K', 'Screen', 'Keyboard', 'Memory', 'CPU', 'Computer'])
    for (const n of g!.chips) expect(CHIPS[n]?.seq, n).toBeDefined()
    const all = CHIP_GROUPS.flatMap((x) => x.chips)
    expect(new Set(all).size).toBe(all.length)
  })
  it('has the course pins', () => {
    const f = (ps: { name: string; width: number }[]) => ps.map((p) => `${p.name}[${p.width}]`).join(' ')
    const pins = (t: string) => `${f(CHIPS[t].inputs)} -> ${f(CHIPS[t].outputs)}`
    expect(pins('ROM32K')).toBe('address[15] -> out[16]')
    expect(pins('Screen')).toBe('in[16] load[1] address[13] -> out[16]')
    expect(pins('Keyboard')).toBe(' -> out[16]')
    expect(pins('Memory')).toBe('in[16] load[1] address[15] -> out[16]')
  })
})

describe('ROM32K', () => {
  const program = [5, 0xffff, 0x1234]
  it('reads the loaded program at every address; empty words are 0', () => {
    const sim = new Simulator(single('ROM32K', { program }))
    expect(sim.eval({ address: 0 }).outputs.out).toBe(5)
    expect(sim.eval({ address: 1 }).outputs.out).toBe(0xffff)
    expect(sim.eval({ address: 2 }).outputs.out).toBe(0x1234)
    expect(sim.eval({ address: 3 }).outputs.out).toBe(0)
    expect(sim.eval({ address: 32767 }).outputs.out).toBe(0) // last address
  })
  it('an address wider than 15 bits is cut to the pin width, never reads outside the array', () => {
    const sim = new Simulator(single('ROM32K', { program }))
    expect(sim.eval({ address: 32768 }).outputs.out).toBe(5) // 32768 & 0x7FFF = 0
  })
  it('without a program it reads 0; loadRom on the Simulator fills it', () => {
    const sim = new Simulator(single('ROM32K'))
    expect(sim.eval({ address: 0 }).outputs.out).toBe(0)
    expect(sim.loadRom([7, 8])).toBe(1)
    expect(sim.eval({ address: 1 }).outputs.out).toBe(8)
  })
  it('is read-only: clocking never changes it, and Reset keeps the program', () => {
    const sim = new Simulator(single('ROM32K', { program }))
    sim.step({ address: 0 })
    sim.reset()
    expect(sim.eval({ address: 2 }).outputs.out).toBe(0x1234)
  })
  it('a program loaded with loadRom survives Reset, and a new load replaces the old one', () => {
    const sim = new Simulator(single('ROM32K'))
    sim.loadRom([1, 2, 3])
    sim.reset()
    expect(sim.eval({ address: 2 }).outputs.out).toBe(3)
    sim.loadRom([9])
    expect(sim.eval({ address: 0 }).outputs.out).toBe(9)
    expect(sim.eval({ address: 1 }).outputs.out).toBe(0)
  })
  it('a program longer than 32768 words is cut at 32768', () => {
    const sim = new Simulator(single('ROM32K'))
    sim.loadRom(new Array(40000).fill(1))
    expect(sim.eval({ address: 32767 }).outputs.out).toBe(1)
  })
})

describe('Screen', () => {
  it('writes at tock (not tick), reads combinationally, 8192 words', () => {
    const sim = new Simulator(single('Screen'))
    const inp = (address: number, v: number, load = 1) => ({ in: v, load, address })
    sim.tick(inp(8191, 0xabcd))
    expect(sim.eval(inp(8191, 0)).outputs.out).toBe(0) // not yet
    sim.tock(inp(8191, 0xabcd))
    expect(sim.eval(inp(8191, 0, 0)).outputs.out).toBe(0xabcd)
    expect(sim.eval(inp(0, 0, 0)).outputs.out).toBe(0) // other words untouched
  })
  it('load = 0 writes nothing', () => {
    const sim = new Simulator(single('Screen'))
    sim.step({ in: 7, load: 0, address: 3 })
    expect(sim.eval({ in: 0, load: 0, address: 3 }).outputs.out).toBe(0)
  })
  it('Reset clears it', () => {
    const sim = new Simulator(single('Screen'))
    sim.step({ in: 7, load: 1, address: 3 })
    sim.reset()
    expect(sim.eval({ in: 0, load: 0, address: 3 }).outputs.out).toBe(0)
  })
})

describe('Keyboard', () => {
  it('shows the value set from the UI / test, masked to 16 bits', () => {
    const sim = new Simulator(single('Keyboard'))
    expect(sim.eval({}).outputs.out).toBe(0)
    expect(sim.setKeyboard(75)).toBe(1)
    expect(sim.eval({}).outputs.out).toBe(75)
    sim.setKeyboard(0x1ffff)
    expect(sim.eval({}).outputs.out).toBe(0xffff)
  })
  it('starts with the value stored in the instance, and Reset keeps the key', () => {
    const sim = new Simulator(single('Keyboard', { key: 128 }))
    expect(sim.eval({}).outputs.out).toBe(128)
    sim.reset()
    expect(sim.eval({}).outputs.out).toBe(128)
  })
})

describe('Memory (RAM16K 0..16383, Screen 16384..24575, Keyboard 24576)', () => {
  const rd = (sim: Simulator, address: number) => sim.eval({ in: 0, load: 0, address }).outputs.out
  const wr = (sim: Simulator, address: number, v: number) => sim.step({ in: v, load: 1, address })

  it('writes and reads RAM at the boundaries 0 and 16383', () => {
    const sim = new Simulator(single('Memory'))
    wr(sim, 0, 11)
    wr(sim, 16383, 22)
    expect(rd(sim, 0)).toBe(11)
    expect(rd(sim, 16383)).toBe(22)
    expect(rd(sim, 1)).toBe(0)
    expect(rd(sim, 16384)).toBe(0) // the screen is a different memory
  })
  it('writes and reads the Screen at 16384 and 24575, apart from RAM', () => {
    const sim = new Simulator(single('Memory'))
    wr(sim, 16384, 33)
    wr(sim, 24575, 44)
    expect(rd(sim, 16384)).toBe(33)
    expect(rd(sim, 24575)).toBe(44)
    expect(rd(sim, 0)).toBe(0)
    expect(rd(sim, 16383)).toBe(0)
  })
  it('address 24576 is the Keyboard: reads the key, a write does nothing', () => {
    const sim = new Simulator(single('Memory'))
    sim.setKeyboard(65)
    expect(rd(sim, 24576)).toBe(65)
    wr(sim, 24576, 999)
    expect(rd(sim, 24576)).toBe(65)
  })
  it('above the keyboard (24577..32767) reads 0 and ignores writes', () => {
    const sim = new Simulator(single('Memory'))
    wr(sim, 24577, 5)
    wr(sim, 32767, 6)
    expect(rd(sim, 24577)).toBe(0)
    expect(rd(sim, 32767)).toBe(0)
    expect(rd(sim, 0)).toBe(0)
  })
  it('write happens at tock; load = 0 writes nothing', () => {
    const sim = new Simulator(single('Memory'))
    sim.tick({ in: 5, load: 1, address: 9 })
    expect(rd(sim, 9)).toBe(0)
    sim.tock({ in: 5, load: 1, address: 9 })
    expect(rd(sim, 9)).toBe(5)
    sim.step({ in: 6, load: 0, address: 9 })
    expect(rd(sim, 9)).toBe(5)
  })
  it('Reset clears RAM and Screen but keeps the keyboard value', () => {
    const sim = new Simulator(single('Memory', { key: 77 }))
    wr(sim, 3, 1)
    wr(sim, 16390, 2)
    sim.reset()
    expect(rd(sim, 3)).toBe(0)
    expect(rd(sim, 16390)).toBe(0)
    expect(rd(sim, 24576)).toBe(77)
  })
  it('peek / poke reach the same words through the map', () => {
    const sim = new Simulator(single('Memory'))
    sim.poke('u', 16385, 9)
    expect(rd(sim, 16385)).toBe(9)
    wr(sim, 4, 8)
    expect(sim.peek('u', 4)).toBe(8)
  })
})

// ---- per-output dependencies ----

/**
 * A stand-in for the Project 5 CPU, with the dependencies the ADR gives it:
 *   outM depends on inM and instruction; addressM and pc come from stored state only.
 * (It is not a real CPU: pc counts up, addressM = pc, outM = inM xor instruction.)
 */
const fakeCpu: ChipDef = {
  name: 'FakeCpu',
  inputs: [
    { name: 'inM', width: 16 },
    { name: 'instruction', width: 16 },
    { name: 'reset', width: 1 },
  ],
  outputs: [
    { name: 'outM', width: 16 },
    { name: 'addressM', width: 15 },
    { name: 'pc', width: 15 },
  ],
  eval: () => ({ outM: 0, addressM: 0, pc: 0 }),
  seq: {
    combInputs: ['inM', 'instruction'],
    deps: { outM: ['inM', 'instruction'], addressM: [], pc: [] },
    init: () => ({ pc: 0, next: 0 }),
    read: (inp, s) => {
      const st = s as { pc: number }
      return { outM: mask((inp.inM ?? 0) ^ (inp.instruction ?? 0), 16), addressM: st.pc, pc: st.pc }
    },
    tick: (inp, s) => void ((s as { next: number }).next = inp.reset ? 0 : (s as { pc: number }).pc + 1),
    tock: (s) => void ((s as { pc: number }).pc = (s as { next: number }).next),
  },
}

describe('per-output dependencies (SeqBehavior.deps)', () => {
  // Test-only chips are registered in the shared table and removed again at the end of this file.
  CHIPS.FakeCpu = fakeCpu
  CHIPS.FakeCpuNoDeps = { ...fakeCpu, name: 'FakeCpuNoDeps', seq: { ...fakeCpu.seq!, deps: undefined } }
  afterAll(() => {
    delete CHIPS.FakeCpu
    delete CHIPS.FakeCpuNoDeps
  })

  /** ROM32K(address <- cpu.pc), Memory(address <- cpu.addressM, in <- cpu.outM): the shape of the Computer. */
  function computer(cpuType = 'FakeCpu'): Circuit {
    let c = emptyCircuit()
    c = addPin(c, 'reset', 'reset', 'input')
    c = addPin(c, 'out', 'out', 'output', 16)
    c = addChip(c, 'cpu', cpuType)
    c = addChip(c, 'rom', 'ROM32K')
    c.chips[1] = { ...c.chips[1], program: [0x00f0, 0x0f00, 0xf000] }
    c = addChip(c, 'mem', 'Memory')
    c = addChip(c, 'one', 'Const', { width: 1, ones: true })
    c = connect(c, { pin: 'reset' }, { chip: 'cpu', pin: 'reset' })
    c = connect(c, { chip: 'cpu', pin: 'pc' }, { chip: 'rom', pin: 'address' })
    c = connect(c, { chip: 'rom', pin: 'out' }, { chip: 'cpu', pin: 'instruction' })
    c = connect(c, { chip: 'mem', pin: 'out' }, { chip: 'cpu', pin: 'inM' })
    c = connect(c, { chip: 'cpu', pin: 'addressM' }, { chip: 'mem', pin: 'address' })
    c = connect(c, { chip: 'cpu', pin: 'outM' }, { chip: 'mem', pin: 'in' })
    c = connect(c, { chip: 'one', pin: 'out' }, { chip: 'mem', pin: 'load' })
    c = connect(c, { chip: 'cpu', pin: 'outM' }, { pin: 'out' })
    return c
  }

  it('the fetch loop ROM32K.out -> CPU -> ROM32K.address is legal when pc does not depend on instruction', () => {
    expect(() => planOrder(computer())).not.toThrow()
  })
  it('and it computes: each step fetches the next word and stores outM in memory', () => {
    const sim = new Simulator(computer())
    expect(sim.eval({ reset: 0 }).outputs.out).toBe(0x00f0) // pc 0: rom[0] xor mem[0] (= 0)
    sim.step({ reset: 0 }) // mem[0] <- 0x00f0, pc -> 1
    expect(sim.eval({ reset: 0 }).outputs.out).toBe(0x0f00) // rom[1] xor mem[1] (= 0)
    sim.step({ reset: 0 })
    expect(sim.eval({ reset: 0 }).outputs.out).toBe(0xf000)
    expect(sim.peek('mem', 0)).toBe(0x00f0)
    expect(sim.peek('mem', 1)).toBe(0x0f00)
  })
  it('a loop through an output that DOES depend on the input is still a cycle (outM -> ROM address)', () => {
    let c = computer()
    c.wires = c.wires.filter((w) => !('chip' in w.to && w.to.chip === 'rom' && w.to.pin === 'address'))
    c = addChip(c, 'cut', 'Split', { width: 16, ranges: [{ lo: 0, hi: 14 }] })
    c = connect(c, { chip: 'cpu', pin: 'outM' }, { chip: 'cut', pin: 'in' })
    c = connect(c, { chip: 'cut', pin: '[0..14]' }, { chip: 'rom', pin: 'address' })
    expect(() => planOrder(c)).toThrow(CircuitError)
    expect(() => planOrder(c)).toThrow(/Cycle/)
  })
  it('a loop through Memory.address <- addressM is fine, but through Memory.address <- outM it is a cycle', () => {
    let c = computer()
    c.wires = c.wires.filter((w) => !('chip' in w.to && w.to.chip === 'mem' && w.to.pin === 'address'))
    c = addChip(c, 'cut', 'Split', { width: 16, ranges: [{ lo: 0, hi: 14 }] })
    c = connect(c, { chip: 'cpu', pin: 'outM' }, { chip: 'cut', pin: 'in' })
    c = connect(c, { chip: 'cut', pin: '[0..14]' }, { chip: 'mem', pin: 'address' })
    // outM depends on inM, inM = Memory.out, Memory.out depends on Memory.address = outM
    expect(() => planOrder(c)).toThrow(/Cycle/)
  })
  it('a chip WITHOUT deps keeps the old rule: every output depends on combInputs, so the same circuit is a cycle', () => {
    expect(() => planOrder(computer('FakeCpuNoDeps'))).toThrow(/Cycle/)
  })
  it('the built-in clocked chips keep their rules', () => {
    for (const n of ['Bit', 'Register', 'ARegister', 'DRegister', 'DFF', 'DFF16', 'PC']) {
      expect(CHIPS[n].seq!.combInputs, n).toEqual([])
    }
    for (const n of ['RAM8', 'RAM64', 'RAM512', 'RAM4K', 'RAM16K', 'ROM32K', 'Screen', 'Memory']) {
      expect(CHIPS[n].seq!.combInputs, n).toEqual(['address'])
    }
    expect(CHIPS.Keyboard.seq!.combInputs).toEqual([])
  })
  it('a RAM address loop is still a cycle; a loop into ROM32K.address from its own out is a cycle', () => {
    let c = emptyCircuit()
    c = addChip(c, 'rom', 'ROM32K')
    c = addChip(c, 'cut', 'Split', { width: 16, ranges: [{ lo: 0, hi: 14 }] })
    c = connect(c, { chip: 'rom', pin: 'out' }, { chip: 'cut', pin: 'in' })
    c = connect(c, { chip: 'cut', pin: '[0..14]' }, { chip: 'rom', pin: 'address' })
    expect(() => planOrder(c)).toThrow(/Cycle/)
  })
})

describe('golden: a hand-written Hack program read through ROM32K', () => {
  // Same loading pattern as the other fixture tests (Vite reads the file as text).
  const files = import.meta.glob('../../tests/fixtures/hack/AddStore.hack', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const text = Object.values(files)[0]

  it('the fixture parses cleanly: 8 instructions', () => {
    const r = parseHack(text)
    expect(r.warnings).toEqual([])
    expect(r.words).toHaveLength(8)
  })

  it('PC counting through ROM32K fetches each instruction in order, then 0 past the program', () => {
    const { words } = parseHack(text)
    // PC (inc = 1, load = 0, reset = 0) -> Split [0..14] -> ROM32K.address; ROM32K.out -> circuit pin.
    let c = emptyCircuit()
    c = addPin(c, 'instr', 'instr', 'output', 16)
    c = addChip(c, 'pc', 'PC')
    c = addChip(c, 'cut', 'Split', { width: 16, ranges: [{ lo: 0, hi: 14 }] })
    c = addChip(c, 'rom', 'ROM32K')
    c.chips[2] = { ...c.chips[2], program: words }
    c = addChip(c, 'zero16', 'Const', { width: 16, ones: false })
    c = addChip(c, 'zero1', 'Const', { width: 1, ones: false })
    c = addChip(c, 'one1', 'Const', { width: 1, ones: true })
    c = connect(c, { chip: 'zero16', pin: 'out' }, { chip: 'pc', pin: 'in' })
    c = connect(c, { chip: 'zero1', pin: 'out' }, { chip: 'pc', pin: 'load' })
    c = connect(c, { chip: 'one1', pin: 'out' }, { chip: 'pc', pin: 'inc' })
    c = connect(c, { chip: 'zero1', pin: 'out' }, { chip: 'pc', pin: 'reset' })
    c = connect(c, { chip: 'pc', pin: 'out' }, { chip: 'cut', pin: 'in' })
    c = connect(c, { chip: 'cut', pin: '[0..14]' }, { chip: 'rom', pin: 'address' })
    c = connect(c, { chip: 'rom', pin: 'out' }, { pin: 'instr' })

    const sim = new Simulator(c)
    const seen: number[] = []
    for (let i = 0; i < 10; i++) {
      seen.push(sim.eval({}).outputs.instr)
      sim.step({})
    }
    expect(seen).toEqual([...words, 0, 0])
    // Reset goes back to the start but keeps the program
    sim.reset()
    expect(sim.eval({}).outputs.instr).toBe(words[0])
  })
})
