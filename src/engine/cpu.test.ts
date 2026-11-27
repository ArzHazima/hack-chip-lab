// Native CPU and Computer chips (Project 5, stage 2).
//
// Clock model for the CPU state (A, D, PC), the same two phases as every other clocked chip:
//   tick: the inputs (inM, instruction, reset) are sampled together with the CURRENT A, D, PC, and the next
//         A, D, PC are computed from them. Nothing visible changes: addressM, pc, outM, writeM still show the old state.
//   tock: the next A, D, PC become the current ones. addressM and pc change now; one instruction has run.
// During an instruction the ALU reads the OLD A and D, and a jump goes to the OLD A (the instruction's own write to A
// takes effect only at tock), exactly like the flip-flops of the real CPU.
// All expected numbers below were worked out by hand (the comments show the working), not produced by the chip.

import { describe, expect, it } from 'vitest'
import { assemble, asm, cInstruction, COMP_NAMES, JUMPS } from '../../tests/helpers/asm'
import { CHIP_GROUPS, CHIPS } from './chips'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { parseHack } from './hack'
import { Simulator } from './sequential'
import { CircuitError, planOrder } from './simulate'

const FIXTURE = import.meta.glob('../../tests/fixtures/hack/AddStore.hack', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

// ---------------------------------------------------------------------------------------------------------------
describe('the test assembler itself (so the golden programs can be trusted)', () => {
  it('encodes known instructions: the stage 1 fixture file, line by line', () => {
    const fromFile = parseHack(Object.values(FIXTURE)[0]).words
    expect(assemble(['@2', 'D=A', '@3', 'D=D+A', '@0', 'M=D', '@6', '0;JMP'])).toEqual(fromFile)
  })
  it('a few by hand: D=A = 1110 1100 0001 0000, M=-1 = 1110 1110 1000 1000, D;JGT = 1110 0011 0000 0001', () => {
    expect(asm('D=A')).toBe(0b1110110000010000)
    expect(asm('M=-1')).toBe(0b1110111010001000)
    expect(asm('D;JGT')).toBe(0b1110001100000001)
    expect(asm('AMD=D+M')).toBe(0b1111000010111000)
  })
})

describe('Project 5 sidebar section now also lists CPU and Computer', () => {
  it('in order, each defined once', () => {
    const g = CHIP_GROUPS.find((x) => x.title.startsWith('Project 5'))
    expect(g?.chips).toEqual(['ROM32K', 'Screen', 'Keyboard', 'Memory', 'CPU', 'Computer'])
    const all = CHIP_GROUPS.flatMap((x) => x.chips)
    expect(new Set(all).size).toBe(all.length)
  })
  it('pins as in the course', () => {
    const f = (ps: { name: string; width: number }[]) => ps.map((p) => `${p.name}[${p.width}]`).join(' ')
    expect(f(CHIPS.CPU.inputs)).toBe('inM[16] instruction[16] reset[1]')
    expect(f(CHIPS.CPU.outputs)).toBe('outM[16] writeM[1] addressM[15] pc[15]')
    expect(f(CHIPS.Computer.inputs)).toBe('reset[1]')
    expect(f(CHIPS.Computer.outputs)).toBe('')
  })
  it('CPU declares per-output dependencies: outM and writeM on inM + instruction, addressM and pc on nothing', () => {
    const seq = CHIPS.CPU.seq!
    expect(seq.deps).toEqual({ outM: ['inM', 'instruction'], writeM: ['inM', 'instruction'], addressM: [], pc: [] })
    expect(CHIPS.Computer.seq!.combInputs).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------
/** A circuit with one CPU whose pins are all circuit pins of the same name. */
function cpuCircuit(): Circuit {
  let c = emptyCircuit()
  c = addChip(c, 'u', 'CPU')
  for (const p of CHIPS.CPU.inputs) {
    c = addPin(c, p.name, p.name, 'input', p.width)
    c = connect(c, { pin: p.name }, { chip: 'u', pin: p.name })
  }
  for (const p of CHIPS.CPU.outputs) {
    c = addPin(c, `o_${p.name}`, p.name, 'output', p.width)
    c = connect(c, { chip: 'u', pin: p.name }, { pin: `o_${p.name}` })
  }
  return c
}

const cpu = () => {
  const sim = new Simulator(cpuCircuit())
  const regs = () => ({ A: sim.peekRegister('u', 'A'), D: sim.peekRegister('u', 'D'), PC: sim.peekRegister('u', 'PC') })
  const out = (inM: number, instruction: number, reset = 0) => sim.eval({ inM, instruction, reset }).outputs
  const step = (inM: number, instruction: number, reset = 0) => sim.step({ inM, instruction, reset })
  return { sim, regs, out, step }
}

describe('CPU: A-instructions', () => {
  it('loads the 15-bit value into A, PC + 1, D unchanged, and never writes memory', () => {
    const { regs, step, out } = cpu()
    step(0, 0x1234)
    expect(regs()).toEqual({ A: 0x1234, D: 0, PC: 1 })
    expect(out(0, 0x0008).writeM).toBe(0) // bit 3 set, but it is an address, not a destination
    step(0, 0x7fff)
    expect(regs()).toEqual({ A: 0x7fff, D: 0, PC: 2 })
    expect(out(0, 0).addressM).toBe(0x7fff)
  })
})

describe('CPU: computations (D = 5, A = 3, inM = 10, no destination, no jump)', () => {
  // hand-computed: with D=5 (0101) A=3 (0011) M=10 (1010), results in 16 bits
  const A_FORMS: [string, number][] = [
    ['0', 0], ['1', 1], ['-1', 0xffff], ['D', 5], ['A', 3], ['!D', 0xfffa], ['!A', 0xfffc], ['-D', 0xfffb], ['-A', 0xfffd],
    ['D+1', 6], ['A+1', 4], ['D-1', 4], ['A-1', 2], ['D+A', 8], ['D-A', 2], ['A-D', 0xfffe], ['D&A', 1], ['D|A', 7],
  ]
  // the a = 1 forms read M instead of A
  const M_FORMS: [string, number][] = [
    ['M', 10], ['!M', 0xfff5], ['-M', 0xfff6], ['M+1', 11], ['M-1', 9], ['D+M', 15], ['D-M', 0xfffb], ['M-D', 5], ['D&M', 0], ['D|M', 15],
  ]
  it.each([...A_FORMS, ...M_FORMS])('%s = %i', (comp, expected) => {
    const { sim, out } = cpu()
    sim.pokeRegister('u', 'D', 5)
    sim.pokeRegister('u', 'A', 3)
    const o = out(10, asm(comp))
    expect(o.outM).toBe(expected)
    expect(o.writeM).toBe(0)
    expect(o.addressM).toBe(3)
    expect(o.pc).toBe(0)
  })
  it('covers every computation the assembler knows (so none is forgotten)', () => {
    const tested = new Set(A_FORMS.map(([c]) => c))
    for (const name of COMP_NAMES) expect(tested.has(name), name).toBe(true)
  })
})

describe('CPU: every destination combination (D + A with D = 5, A = 3 gives 8)', () => {
  for (let dest = 0; dest < 8; dest++) {
    const names = `${dest & 4 ? 'A' : ''}${dest & 2 ? 'D' : ''}${dest & 1 ? 'M' : ''}` || '(none)'
    it(`dest ${names}`, () => {
      const { sim, regs, out, step } = cpu()
      sim.pokeRegister('u', 'D', 5)
      sim.pokeRegister('u', 'A', 3)
      const ins = cInstruction(0, 0b000010, dest, 0)
      expect(out(0, ins).writeM).toBe(dest & 1) // writeM is combinational: visible BEFORE the clock
      expect(out(0, ins).outM).toBe(8)
      step(0, ins)
      expect(regs()).toEqual({ A: dest & 4 ? 8 : 3, D: dest & 2 ? 8 : 5, PC: 1 })
    })
  }
})

describe('CPU: every jump condition (all 8) for a negative, zero and positive result; A = 100, PC = 10', () => {
  // jump bits j1 j2 j3 = out<0, out=0, out>0; expected "jumps?" for [negative, zero, positive]
  const TABLE: Record<string, [boolean, boolean, boolean]> = {
    '': [false, false, false], JGT: [false, false, true], JEQ: [false, true, false], JGE: [false, true, true],
    JLT: [true, false, false], JNE: [true, false, true], JLE: [true, true, false], JMP: [true, true, true],
  }
  const RESULT = [['-1', 'negative'], ['0', 'zero'], ['1', 'positive']] as const
  for (const [name, expectedJumps] of Object.entries(TABLE)) {
    RESULT.forEach(([comp, label], i) => {
      it(`${name || 'no jump'} with a ${label} result ${expectedJumps[i] ? 'jumps to A' : 'goes to PC + 1'}`, () => {
        const { sim, regs, step } = cpu()
        sim.pokeRegister('u', 'A', 100)
        sim.pokeRegister('u', 'PC', 10)
        step(0, cInstruction(0, asm(comp) >> 6 & 0x3f, 0, JUMPS[name]))
        expect(regs().PC).toBe(expectedJumps[i] ? 100 : 11)
        expect(regs().A).toBe(100) // no destination: A untouched
      })
    })
  }
  it('a jump goes to the OLD A even when the same instruction writes A (AD=D-1;JNE)', () => {
    const { sim, regs, step } = cpu()
    sim.pokeRegister('u', 'A', 100)
    sim.pokeRegister('u', 'D', 8)
    step(0, asm('AD=D-1;JNE')) // out = 7: not zero, so jump to the old A = 100; the new A is 7
    expect(regs()).toEqual({ A: 7, D: 7, PC: 100 })
  })
  it('an A-instruction never jumps (even with all jump-looking bits set)', () => {
    const { sim, regs, step } = cpu()
    sim.pokeRegister('u', 'PC', 20)
    step(0, 0x0007)
    expect(regs()).toEqual({ A: 7, D: 0, PC: 21 })
  })
})

describe('CPU: reset', () => {
  it('sets PC to 0 even for a jump, and does not touch A or D by itself', () => {
    const { sim, regs, step } = cpu()
    sim.pokeRegister('u', 'A', 100)
    sim.pokeRegister('u', 'D', 9)
    sim.pokeRegister('u', 'PC', 50)
    step(0, asm('0;JMP'), 1)
    expect(regs()).toEqual({ A: 100, D: 9, PC: 0 }) // reset beats the jump; the instruction had no destination
  })
  it('the instruction in the reset cycle still runs: its A / D writes happen, only PC is forced to 0', () => {
    const { sim, regs, step } = cpu()
    sim.pokeRegister('u', 'PC', 50)
    step(0, asm('@77'), 1)
    expect(regs()).toEqual({ A: 77, D: 0, PC: 0 })
    step(0, asm('D=A'), 0)
    expect(regs()).toEqual({ A: 77, D: 77, PC: 1 })
  })
  it('the Simulator Reset button clears A, D and PC', () => {
    const { sim, regs, step } = cpu()
    step(0, 5)
    sim.reset()
    expect(regs()).toEqual({ A: 0, D: 0, PC: 0 })
  })
})

describe('CPU: timing of tick and tock', () => {
  it('tick samples and changes nothing visible; tock commits A, D and PC', () => {
    const { sim } = cpu()
    const inp = { inM: 0, instruction: asm('@9'), reset: 0 }
    sim.tick(inp)
    expect(sim.eval(inp).outputs).toMatchObject({ addressM: 0, pc: 0 }) // still the old state
    // ...but the register a .tst script reads (ARegister[]) already shows the value latched at the tick, as the
    // course's CPU.cmp expects at time "1+" (the output PINS change only at tock).
    expect(sim.peekRegister('u', 'A')).toBe(9)
    sim.tock(inp)
    expect(sim.eval(inp).outputs).toMatchObject({ addressM: 9, pc: 1 })
    expect(sim.peekRegister('u', 'A')).toBe(9)
  })
  it('the instruction is sampled at tick: changing the inputs between tick and tock does not matter', () => {
    const { sim, regs } = cpu()
    sim.tick({ inM: 0, instruction: asm('@9'), reset: 0 })
    sim.tock({ inM: 0, instruction: asm('@55'), reset: 1 }) // ignored: tock only commits what tick sampled
    expect(regs()).toEqual({ A: 9, D: 0, PC: 1 })
  })
  it('PC wraps at 15 bits (32767 + 1 = 0)', () => {
    const { sim, regs, step } = cpu()
    sim.pokeRegister('u', 'PC', 32767)
    step(0, 1)
    expect(regs().PC).toBe(0)
  })
})

describe('CPU: its ALU agrees with the ALU chip', () => {
  it('for 2,000 pseudo-random control / operand combinations (outM equals CHIPS.ALU, writeM from bit 3)', () => {
    let seed = 12345
    const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) % n
    const { sim, out } = cpu()
    for (let i = 0; i < 2000; i++) {
      const D = rnd(65536), A = rnd(65536), M = rnd(65536)
      const ctrl = rnd(64), a = rnd(2), dest = rnd(8)
      sim.pokeRegister('u', 'D', D)
      sim.pokeRegister('u', 'A', A)
      const ins = cInstruction(a, ctrl, dest, rnd(8))
      const bit = (k: number) => (ctrl >> k) & 1 // ctrl = zx nx zy ny f no, zx is the top bit
      const alu = CHIPS.ALU.eval({ x: D, y: a ? M : A, zx: bit(5), nx: bit(4), zy: bit(3), ny: bit(2), f: bit(1), no: bit(0) })
      const o = out(M, ins)
      expect(o.outM, `ins ${ins.toString(2)} D ${D} A ${A} M ${M}`).toBe(alu.out)
      expect(o.writeM).toBe(dest & 1)
    }
  })
})

describe('CPU and Computer expose their internal state (by chip type, for the stage 3 .tst syntax)', () => {
  it('exposes ARegister, DRegister and PC', () => {
    for (const t of ['CPU', 'Computer']) expect(CHIPS[t].seq!.exposes).toEqual({ ARegister: 'A', DRegister: 'D', PC: 'PC' })
  })
  it('peekRegister / pokeRegister: values are masked (A, D to 16 bits, PC to 15 bits); unknown names are ignored', () => {
    const { sim } = cpu()
    sim.pokeRegister('u', 'A', 0x12345)
    sim.pokeRegister('u', 'PC', 0x12345)
    sim.pokeRegister('u', 'D', -1)
    expect([sim.peekRegister('u', 'A'), sim.peekRegister('u', 'PC'), sim.peekRegister('u', 'D')]).toEqual([0x2345, 0x2345, 0xffff])
    expect(sim.peekRegister('u', 'X')).toBeUndefined()
    sim.pokeRegister('u', 'X', 1)
    expect(sim.peekRegister('nope', 'A')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Computer: ROM32K + CPU + Memory (with Screen and Keyboard) inside one chip.

function computerCircuit(program: number[], key?: number): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'reset', 'reset', 'input')
  c = addChip(c, 'u', 'Computer')
  c.chips[0] = { ...c.chips[0], program, ...(key === undefined ? {} : { key }) }
  return connect(c, { pin: 'reset' }, { chip: 'u', pin: 'reset' })
}
const computer = (lines: string[], key?: number) => {
  const sim = new Simulator(computerCircuit(assemble(lines), key))
  const run = (n: number) => {
    for (let i = 0; i < n; i++) sim.step({ reset: 0 })
  }
  const regs = () => ({ A: sim.peekRegister('u', 'A'), D: sim.peekRegister('u', 'D'), PC: sim.peekRegister('u', 'PC') })
  return { sim, run, regs, ram: (i: number) => sim.peek('u', i) }
}

describe('Computer golden programs (expected A, D, PC after N cycles worked out by hand)', () => {
  it('arithmetic: 2 + 3 stored in RAM[0], then an endless loop', () => {
    // 0 @2  1 D=A  2 @3  3 D=D+A  4 @0  5 M=D  6 @6  7 0;JMP        (each row: after N cycles)
    const { run, regs, ram } = computer(['@2', 'D=A', '@3', 'D=D+A', '@0', 'M=D', '@6', '0;JMP'])
    const table: [number, number, number, number, number][] = [
      // N, A, D, PC, RAM[0]
      [1, 2, 0, 1, 0], //  @2
      [2, 2, 2, 2, 0], //  D=A          D = 2
      [3, 3, 2, 3, 0], //  @3
      [4, 3, 5, 4, 0], //  D=D+A        D = 2 + 3
      [5, 0, 5, 5, 0], //  @0
      [6, 0, 5, 6, 5], //  M=D          RAM[0] = 5
      [7, 6, 5, 7, 5], //  @6
      [8, 6, 5, 6, 5], //  0;JMP        PC = A = 6
      [9, 6, 5, 7, 5], //  @6 again (instruction 6 is "@6")
      [10, 6, 5, 6, 5],
    ]
    let done = 0
    for (const [n, A, D, PC, r0] of table) {
      run(n - done)
      done = n
      expect({ n, ...regs(), r0: ram(0) }, `after ${n} cycles`).toEqual({ n, A, D, PC, r0 })
    }
  })

  it('a countdown loop with a conditional jump', () => {
    // 0 @3  1 D=A  2 @100  3 M=D  4 D=D-1  5 @4  6 D;JGT  7 @7  8 0;JMP
    const { run, regs, ram } = computer(['@3', 'D=A', '@100', 'M=D', 'D=D-1', '@4', 'D;JGT', '@7', '0;JMP'])
    const table: [number, number, number, number][] = [
      // N, A, D, PC
      [1, 3, 0, 1], [2, 3, 3, 2], [3, 100, 3, 3], [4, 100, 3, 4], //  RAM[100] = 3
      [5, 100, 2, 5], //  D = 3 - 1
      [6, 4, 2, 6], //  @4
      [7, 4, 2, 4], //  D=2 > 0: jump to 4
      [8, 4, 1, 5], [9, 4, 1, 6], [10, 4, 1, 4], //  D=1 > 0: jump again
      [11, 4, 0, 5], [12, 4, 0, 6],
      [13, 4, 0, 7], //  D=0: no jump, falls through to 7
      [14, 7, 0, 8], //  @7
      [15, 7, 0, 7], //  0;JMP: PC = A = 7
      [16, 7, 0, 8],
    ]
    let done = 0
    for (const [n, A, D, PC] of table) {
      run(n - done)
      done = n
      expect(regs(), `after ${n} cycles`).toEqual({ A, D, PC })
    }
    expect(ram(100)).toBe(3) // the stored start value is untouched by the loop
  })

  it('writes a value to memory and reads it back', () => {
    // 0 @21  1 D=A  2 @50  3 M=D  4 D=0  5 D=M  6 @51  7 M=D+1
    const { run, regs, ram } = computer(['@21', 'D=A', '@50', 'M=D', 'D=0', 'D=M', '@51', 'M=D+1'])
    const table: [number, number, number, number, number, number][] = [
      // N, A, D, PC, RAM[50], RAM[51]
      [1, 21, 0, 1, 0, 0], [2, 21, 21, 2, 0, 0], [3, 50, 21, 3, 0, 0],
      [4, 50, 21, 4, 21, 0], //  M=D: RAM[50] = 21
      [5, 50, 0, 5, 21, 0], //  D=0
      [6, 50, 21, 6, 21, 0], //  D=M: reads RAM[50] back
      [7, 51, 21, 7, 21, 0],
      [8, 51, 21, 8, 21, 22], //  M=D+1: RAM[51] = 22
    ]
    let done = 0
    for (const [n, A, D, PC, r50, r51] of table) {
      run(n - done)
      done = n
      expect({ ...regs(), r50: ram(50), r51: ram(51) }, `after ${n} cycles`).toEqual({ A, D, PC, r50, r51 })
    }
  })

  it('writes to the Screen address range (16384 .. 24575) and not to RAM', () => {
    // 0 @16384  1 M=-1  2 @24575  3 M=-1
    const { run, regs, ram } = computer(['@16384', 'M=-1', '@24575', 'M=-1'])
    run(1)
    expect(regs()).toEqual({ A: 16384, D: 0, PC: 1 })
    expect(ram(16384)).toBe(0) // not yet written
    run(1)
    expect(ram(16384)).toBe(0xffff) // first Screen word
    expect(ram(16385)).toBe(0)
    expect(ram(0)).toBe(0) // RAM is a different memory
    expect(ram(16383)).toBe(0)
    run(2)
    expect(regs()).toEqual({ A: 24575, D: 0, PC: 4 })
    expect(ram(24575)).toBe(0xffff) // last Screen word
  })

  it('reads the Keyboard address (24576) and copies the key to RAM[1]', () => {
    // 0 @24576  1 D=M  2 @1  3 M=D  4 @0  5 0;JMP
    const { sim, run, regs, ram } = computer(['@24576', 'D=M', '@1', 'M=D', '@0', '0;JMP'], 75)
    run(4)
    expect(regs()).toEqual({ A: 1, D: 75, PC: 4 })
    expect(ram(1)).toBe(75)
    sim.setKeyboard(81) // a different key is pressed while the program loops
    run(2)
    expect(regs().PC).toBe(0) // @0, 0;JMP
    run(4) // @24576, D=M (81), @1, M=D
    expect(regs()).toEqual({ A: 1, D: 81, PC: 4 })
    expect(ram(1)).toBe(81)
  })

  it('a write to the keyboard word is ignored', () => {
    const { run, ram } = computer(['@24576', 'M=-1', '@1', 'D=M'], 7)
    run(2)
    expect(ram(24576)).toBe(7)
  })
})

describe('Computer: reset pin, Reset button, peek / poke, program', () => {
  const PROG = ['@2', 'D=A', '@3', 'D=D+A', '@0', 'M=D', '@6', '0;JMP']

  it('the reset pin makes PC 0 and keeps everything else; the program then runs again from the start', () => {
    const { sim, run, regs, ram } = computer(PROG)
    run(6)
    expect(regs()).toEqual({ A: 0, D: 5, PC: 6 })
    sim.step({ reset: 1 }) // instruction 6 (@6) still runs, PC is forced to 0
    expect(regs()).toEqual({ A: 6, D: 5, PC: 0 })
    expect(ram(0)).toBe(5) // memory is kept
    run(2) // @2, D=A
    expect(regs()).toEqual({ A: 2, D: 2, PC: 2 })
  })

  it('the Reset button clears A, D, PC, RAM and Screen but keeps the program (and the key)', () => {
    const { sim, run, regs, ram } = computer(PROG, 9)
    sim.poke('u', 16384, 5)
    run(6)
    sim.reset()
    expect(regs()).toEqual({ A: 0, D: 0, PC: 0 })
    expect(ram(0)).toBe(0)
    expect(ram(16384)).toBe(0)
    expect(ram(24576)).toBe(9)
    run(6)
    expect(ram(0)).toBe(5) // the same program runs again
  })

  it('poke A, D, PC and memory: the next instruction uses them', () => {
    const { sim, regs, run } = computer(['@0', '@0', '@0', '@0', '@0', 'D=M'])
    sim.poke('u', 50, 9)
    sim.pokeRegister('u', 'A', 50)
    sim.pokeRegister('u', 'PC', 5)
    run(1) // D=M with A = 50
    expect(regs()).toEqual({ A: 50, D: 9, PC: 6 })
  })

  it('loadRom replaces the program; a Computer with no program just executes @0 forever', () => {
    const sim = new Simulator(computerCircuit([]))
    sim.step({ reset: 0 })
    expect([sim.peekRegister('u', 'A'), sim.peekRegister('u', 'PC')]).toEqual([0, 1])
    expect(sim.loadRom(assemble(['@5', 'D=A']))).toBe(1)
    sim.reset()
    sim.step({ reset: 0 })
    sim.step({ reset: 0 })
    expect([sim.peekRegister('u', 'A'), sim.peekRegister('u', 'D')]).toEqual([5, 5])
  })

  it('has no outputs, and the Simulator still runs it (a chip without outputs is still a step)', () => {
    const sim = new Simulator(computerCircuit(assemble(['@1'])))
    expect(sim.eval({ reset: 0 }).outputs).toEqual({})
    expect(sim.stored()).toEqual({ u: 0 }) // the PC badge
    sim.step({ reset: 0 })
    expect(sim.stored()).toEqual({ u: 1 })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The same machine built on the board from the built-in blocks ROM32K + CPU + Memory.

function boardComputer(program: number[], addressFrom: 'addressM' | 'outM' = 'addressM'): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'reset', 'reset', 'input')
  c = addChip(c, 'cpu', 'CPU')
  c = addChip(c, 'rom', 'ROM32K')
  c.chips[1] = { ...c.chips[1], program }
  c = addChip(c, 'mem', 'Memory')
  c = connect(c, { pin: 'reset' }, { chip: 'cpu', pin: 'reset' })
  c = connect(c, { chip: 'cpu', pin: 'pc' }, { chip: 'rom', pin: 'address' })
  c = connect(c, { chip: 'rom', pin: 'out' }, { chip: 'cpu', pin: 'instruction' })
  c = connect(c, { chip: 'mem', pin: 'out' }, { chip: 'cpu', pin: 'inM' })
  c = connect(c, { chip: 'cpu', pin: 'outM' }, { chip: 'mem', pin: 'in' })
  c = connect(c, { chip: 'cpu', pin: 'writeM' }, { chip: 'mem', pin: 'load' })
  if (addressFrom === 'addressM') {
    c = connect(c, { chip: 'cpu', pin: 'addressM' }, { chip: 'mem', pin: 'address' })
  } else {
    // a deliberate combinational loop: outM depends on inM = Memory.out, which depends on Memory.address = outM
    c = addChip(c, 'cut', 'Split', { width: 16, ranges: [{ lo: 0, hi: 14 }] })
    c = connect(c, { chip: 'cpu', pin: 'outM' }, { chip: 'cut', pin: 'in' })
    c = connect(c, { chip: 'cut', pin: '[0..14]' }, { chip: 'mem', pin: 'address' })
  }
  return c
}

describe('cycle rules with the real chips', () => {
  const PROG = assemble(['@2', 'D=A', '@3', 'D=D+A', '@0', 'M=D', '@6', '0;JMP'])

  it('Computer built from ROM32K + CPU + Memory on the board is accepted (no false cycle)', () => {
    expect(() => planOrder(boardComputer(PROG))).not.toThrow()
  })

  it('and it behaves exactly like the native Computer, cycle by cycle', () => {
    const board = new Simulator(boardComputer(PROG))
    const native = new Simulator(computerCircuit(PROG))
    for (let n = 1; n <= 12; n++) {
      board.step({ reset: 0 })
      native.step({ reset: 0 })
      expect(board.peekRegister('cpu', 'PC'), `PC after ${n}`).toBe(native.peekRegister('u', 'PC'))
      expect(board.peekRegister('cpu', 'A'), `A after ${n}`).toBe(native.peekRegister('u', 'A'))
      expect(board.peekRegister('cpu', 'D'), `D after ${n}`).toBe(native.peekRegister('u', 'D'))
      expect(board.peek('mem', 0), `RAM[0] after ${n}`).toBe(native.peek('u', 0))
    }
    expect(board.peek('mem', 0)).toBe(5)
  })

  it('a deliberate loop outM -> Memory.address is still rejected as a cycle', () => {
    expect(() => planOrder(boardComputer(PROG, 'outM'))).toThrow(CircuitError)
    expect(() => planOrder(boardComputer(PROG, 'outM'))).toThrow(/Cycle/)
  })

  it('and wiring ROM32K.address from outM (instead of pc) is a cycle too', () => {
    const c = boardComputer(PROG)
    c.wires = c.wires.filter((w) => !('chip' in w.to && w.to.chip === 'rom'))
    c.chips.push({ id: 'cut', type: 'Split', params: { width: 16, ranges: [{ lo: 0, hi: 14 }] } })
    c.wires.push(
      { id: 'x1', from: { chip: 'cpu', pin: 'outM' }, to: { chip: 'cut', pin: 'in' } },
      { id: 'x2', from: { chip: 'cut', pin: '[0..14]' }, to: { chip: 'rom', pin: 'address' } },
    )
    expect(() => planOrder(c)).toThrow(/Cycle/)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('speed (reported, with a very loose floor so a slow CI machine does not fail)', () => {
  const COUNT = ['@0', 'M=M+1', '@0', '0;JMP'] // counts up in RAM[0] forever: 4 instructions per round

  function cyclesPerSecond(sim: Simulator, cycles: number): number {
    for (let i = 0; i < 200; i++) sim.step({ reset: 0 }) // warm up
    const t0 = performance.now()
    for (let i = 0; i < cycles; i++) sim.step({ reset: 0 })
    return cycles / ((performance.now() - t0) / 1000)
  }

  it('native Computer vs the same machine built from ROM32K + CPU + Memory blocks', () => {
    const program = assemble(COUNT)
    const native = new Simulator(computerCircuit(program))
    const board = new Simulator(boardComputer(program))
    const nativeSpeed = cyclesPerSecond(native, 20000)
    const boardSpeed = cyclesPerSecond(board, 5000)
    console.log(`SPEED native Computer: ${Math.round(nativeSpeed)} cycles/s; ROM32K+CPU+Memory on the board: ${Math.round(boardSpeed)} cycles/s`)
    expect(native.peek('u', 0)).toBeGreaterThan(1000) // it really counted
    expect(nativeSpeed).toBeGreaterThan(2000)
    expect(nativeSpeed).toBeGreaterThan(boardSpeed)
  })
})
