// Project 5 built-in chips: ROM32K, Screen, Keyboard, Memory, CPU and Computer.
// Same clock model as every other clocked chip: reads are combinational, writes happen at tock.
// Every memory is a Uint16Array allocated ONCE per chip instance; Reset clears RAM/Screen with fill(0)
// and never allocates again. Only TYPES are imported from chips.ts, so there is no import cycle.

import type { ChipDef, PinDef, SeqBehavior } from './chips'
import type { ChipInstance } from './circuit'
import { cpuNext, cpuOutputs, type CpuRegs } from './cpu'

export const ROM_WORDS = 32768 // 2^15 instructions
export const SCREEN_WORDS = 8192 // 2^13 words (512 x 256 pixels, 16 per word)
export const RAM_WORDS = 16384 // RAM16K
export const SCREEN_BASE = 16384 // first Screen address in Memory
export const KEYBOARD_ADDR = 24576 // the Keyboard word in Memory

const p = (name: string, width = 1): PinDef => ({ name, width })
const W = 16
const w16 = (v: number): number => (v | 0) & 0xffff

function make(name: string, inputs: PinDef[], outputs: PinDef[], seq: SeqBehavior): ChipDef {
  return { name, inputs, outputs, seq, eval: (inp) => seq.read(inp, seq.init()) }
}

// ---- ROM32K: read-only program memory ----

type Rom = { rom: Uint16Array }

function fillRom(rom: Uint16Array, words: ArrayLike<number>): void {
  rom.fill(0)
  const n = Math.min(words.length, ROM_WORDS) // anything beyond 32768 words does not fit and is ignored
  for (let i = 0; i < n; i++) rom[i] = words[i] // a Uint16Array keeps only the low 16 bits
}

const rom32k = make('ROM32K', [p('address', 15)], [p('out', W)], {
  combInputs: ['address'],
  init: (inst?: ChipInstance): Rom => {
    const s: Rom = { rom: new Uint16Array(ROM_WORDS) }
    if (inst?.program) fillRom(s.rom, inst.program)
    return s
  },
  read: (inp, s) => ({ out: (s as Rom).rom[inp.address & 0x7fff] ?? 0 }),
  tick: () => {},
  tock: () => {},
  reset: () => {}, // Reset clears the machine, not the program
  loadRom: (s, words) => fillRom((s as Rom).rom, words),
  peek: (s, i = 0) => (s as Rom).rom[i] ?? 0,
})

// ---- Screen: 8K words of video memory ----

type Ram = { mem: Uint16Array; pendAddr: number; pendVal: number } // pendAddr -1 = nothing to write

const screen = make('Screen', [p('in', W), p('load'), p('address', 13)], [p('out', W)], {
  combInputs: ['address'],
  init: (): Ram => ({ mem: new Uint16Array(SCREEN_WORDS), pendAddr: -1, pendVal: 0 }),
  read: (inp, s) => ({ out: (s as Ram).mem[inp.address] ?? 0 }),
  tick: (inp, s) => {
    const r = s as Ram
    r.pendAddr = inp.load ? inp.address : -1
    r.pendVal = inp.in
  },
  tock: (s) => {
    const r = s as Ram
    if (r.pendAddr >= 0 && r.pendAddr < SCREEN_WORDS) r.mem[r.pendAddr] = r.pendVal
    r.pendAddr = -1
  },
  reset: (s) => {
    const r = s as Ram
    r.mem.fill(0)
    r.pendAddr = -1
  },
  peek: (s, i = 0) => (s as Ram).mem[i] ?? 0,
  poke: (s, i, v) => {
    const r = s as Ram
    if (i >= 0 && i < SCREEN_WORDS) r.mem[i] = v
  },
})

// ---- Keyboard: one word, the key that is held ----

type Key = { key: number }

const keyboard = make('Keyboard', [], [p('out', W)], {
  combInputs: [],
  init: (inst?: ChipInstance): Key => ({ key: w16(inst?.key ?? 0) }),
  read: (_inp, s) => ({ out: (s as Key).key }),
  tick: () => {},
  tock: () => {},
  reset: () => {}, // the key that is held is not part of the machine's memory
  setKey: (s, k) => void ((s as Key).key = w16(k)),
  peek: (s) => (s as Key).key,
  poke: (s, _i, v) => void ((s as Key).key = w16(v)),
})

// ---- Memory: the Hack data memory map ----
//   0..16383 RAM16K,  16384..24575 Screen,  24576 Keyboard (read only),  24577..32767 nothing (reads 0)

export type MemoryState = { ram: Uint16Array; screen: Uint16Array; key: number; pendAddr: number; pendVal: number }

const newMemory = (key = 0): MemoryState => ({
  ram: new Uint16Array(RAM_WORDS),
  screen: new Uint16Array(SCREEN_WORDS),
  key: w16(key),
  pendAddr: -1,
  pendVal: 0,
})

export function readMap(m: MemoryState, a: number): number {
  if (a < RAM_WORDS) return m.ram[a]
  if (a < KEYBOARD_ADDR) return m.screen[a - SCREEN_BASE]
  return a === KEYBOARD_ADDR ? m.key : 0
}

export function writeMap(m: MemoryState, a: number, v: number): void {
  if (a < RAM_WORDS) m.ram[a] = v
  else if (a < KEYBOARD_ADDR) m.screen[a - SCREEN_BASE] = v
  // the keyboard word and everything above it ignore writes
}

const clearMemory = (m: MemoryState): void => {
  m.ram.fill(0)
  m.screen.fill(0)
  m.pendAddr = -1 // the key is kept
}

const memory = make('Memory', [p('in', W), p('load'), p('address', 15)], [p('out', W)], {
  combInputs: ['address'],
  init: (inst?: ChipInstance): MemoryState => newMemory(inst?.key),
  read: (inp, s) => ({ out: readMap(s as MemoryState, inp.address) }),
  tick: (inp, s) => {
    const m = s as MemoryState
    m.pendAddr = inp.load ? inp.address : -1
    m.pendVal = inp.in
  },
  tock: (s) => {
    const m = s as MemoryState
    if (m.pendAddr >= 0) writeMap(m, m.pendAddr, m.pendVal)
    m.pendAddr = -1
  },
  reset: (s) => clearMemory(s as MemoryState),
  setKey: (s, k) => void ((s as MemoryState).key = w16(k)),
  peek: (s, i = 0) => readMap(s as MemoryState, i),
  poke: (s, i, v) => writeMap(s as MemoryState, i, v),
})

// ---- CPU: the Hack CPU with its own A, D and PC (logic in cpu.ts) ----
//
// State changes in two phases, like every clocked chip:
//   tick  samples inM, instruction and reset together with the CURRENT A, D, PC and computes the next A, D, PC
//         (outputs do not change);
//   tock  makes the next A, D, PC the current ones (addressM and pc change now).
// Outputs: addressM = A and pc = PC come from the stored state only; outM and writeM are combinational from
// inM, instruction and the stored A, D. That is why `deps` lists no input for addressM and pc.

type CpuState = { cur: CpuRegs; next: CpuRegs }

const newCpu = (): CpuState => ({ cur: { a: 0, d: 0, pc: 0 }, next: { a: 0, d: 0, pc: 0 } })

/** Internal registers that the stage 3 .tst syntax will reach by chip TYPE: ARegister[], DRegister[], PC[]. */
const EXPOSES = { ARegister: 'A', DRegister: 'D', PC: 'PC' } as const

function peekRegs(r: CpuRegs, name: string): number | undefined {
  return name === 'A' ? r.a : name === 'D' ? r.d : name === 'PC' ? r.pc : undefined
}

function pokeRegs(r: CpuRegs, name: string, v: number): void {
  if (name === 'A') r.a = v & 0xffff
  else if (name === 'D') r.d = v & 0xffff
  else if (name === 'PC') r.pc = v & 0x7fff
}

const cpuDeps = ['inM', 'instruction'] as const

const cpu = make(
  'CPU',
  [p('inM', W), p('instruction', W), p('reset')],
  [p('outM', W), p('writeM'), p('addressM', 15), p('pc', 15)],
  {
    combInputs: cpuDeps,
    deps: { outM: cpuDeps, writeM: cpuDeps, addressM: [], pc: [] },
    init: newCpu,
    read: (inp, s) => {
      // Called once per group of outputs with only that group's inputs filled in (missing ones are 0 here).
      const cur = (s as CpuState).cur
      const o = cpuOutputs(cur, inp.inM ?? 0, inp.instruction ?? 0)
      return { outM: o.outM, writeM: o.writeM, addressM: cur.a & 0x7fff, pc: cur.pc }
    },
    tick: (inp, s) => {
      const st = s as CpuState
      st.next = cpuNext(st.cur, inp.inM, inp.instruction, inp.reset)
    },
    tock: (s) => {
      const st = s as CpuState
      st.cur = { ...st.next }
    },
    stored: (s) => (s as CpuState).cur.pc,
    exposes: EXPOSES,
    peekReg: (s, name) => peekRegs((s as CpuState).cur, name),
    pokeReg: (s, name, v) => pokeRegs((s as CpuState).cur, name, v),
  },
)

// ---- Computer: ROM32K + CPU + Memory (RAM16K, Screen, Keyboard) in one block, wired as in the course ----
//
// Per clock cycle: tick reads the instruction at PC from the ROM and inM from the data memory at A, computes the
// CPU's next registers and a pending memory write (when writeM: address A, value outM); tock commits both.
// The only input is `reset` (sampled at tick, forces PC to 0 for that cycle). Program: ChipInstance.program or
// loadRom. Reset button (Simulator.reset): A, D, PC, RAM and Screen are cleared; ROM program and key are kept.

type ComputerState = { cpu: CpuState; rom: Uint16Array; mem: MemoryState }

const computer = make('Computer', [p('reset')], [], {
  combInputs: [],
  init: (inst?: ChipInstance): ComputerState => {
    const rom = new Uint16Array(ROM_WORDS)
    if (inst?.program) fillRom(rom, inst.program)
    return { cpu: newCpu(), rom, mem: newMemory(inst?.key) }
  },
  read: () => ({}),
  tick: (inp, s) => {
    const st = s as ComputerState
    const regs = st.cpu.cur
    const address = regs.a & 0x7fff
    const instruction = st.rom[regs.pc]
    const inM = readMap(st.mem, address)
    const out = cpuOutputs(regs, inM, instruction)
    st.cpu.next = cpuNext(regs, inM, instruction, inp.reset)
    st.mem.pendAddr = out.writeM ? address : -1
    st.mem.pendVal = out.outM
  },
  tock: (s) => {
    const st = s as ComputerState
    st.cpu.cur = { ...st.cpu.next }
    if (st.mem.pendAddr >= 0) writeMap(st.mem, st.mem.pendAddr, st.mem.pendVal)
    st.mem.pendAddr = -1
  },
  reset: (s) => {
    const st = s as ComputerState
    st.cpu = newCpu()
    clearMemory(st.mem)
  },
  stored: (s) => (s as ComputerState).cpu.cur.pc,
  loadRom: (s, words) => fillRom((s as ComputerState).rom, words),
  setKey: (s, k) => void ((s as ComputerState).mem.key = w16(k)),
  peek: (s, i = 0) => readMap((s as ComputerState).mem, i),
  poke: (s, i, v) => writeMap((s as ComputerState).mem, i, v),
  exposes: EXPOSES,
  peekReg: (s, name) => peekRegs((s as ComputerState).cpu.cur, name),
  pokeReg: (s, name, v) => pokeRegs((s as ComputerState).cpu.cur, name, v),
})

export const PROJECT5_CHIPS: ChipDef[] = [rom32k, screen, keyboard, memory, cpu, computer]
