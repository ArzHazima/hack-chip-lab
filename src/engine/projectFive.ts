// Project 5 memory chips: ROM32K, Screen, Keyboard, Memory (the CPU and Computer come in a later stage).
// Same clock model as every other clocked chip: reads are combinational, writes happen at tock.
// Every memory is a Uint16Array allocated ONCE per chip instance; Reset clears RAM/Screen with fill(0)
// and never allocates again. Only TYPES are imported from chips.ts, so there is no import cycle.

import type { ChipDef, PinDef, SeqBehavior } from './chips'
import type { ChipInstance } from './circuit'

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

type MemoryState = { ram: Uint16Array; screen: Uint16Array; key: number; pendAddr: number; pendVal: number }

function readMap(m: MemoryState, a: number): number {
  if (a < RAM_WORDS) return m.ram[a]
  if (a < KEYBOARD_ADDR) return m.screen[a - SCREEN_BASE]
  return a === KEYBOARD_ADDR ? m.key : 0
}

function writeMap(m: MemoryState, a: number, v: number): void {
  if (a < RAM_WORDS) m.ram[a] = v
  else if (a < KEYBOARD_ADDR) m.screen[a - SCREEN_BASE] = v
  // the keyboard word and everything above it ignore writes
}

const memory = make('Memory', [p('in', W), p('load'), p('address', 15)], [p('out', W)], {
  combInputs: ['address'],
  init: (inst?: ChipInstance): MemoryState => ({
    ram: new Uint16Array(RAM_WORDS),
    screen: new Uint16Array(SCREEN_WORDS),
    key: w16(inst?.key ?? 0),
    pendAddr: -1,
    pendVal: 0,
  }),
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
  reset: (s) => {
    const m = s as MemoryState
    m.ram.fill(0)
    m.screen.fill(0)
    m.pendAddr = -1 // the key is kept
  },
  setKey: (s, k) => void ((s as MemoryState).key = w16(k)),
  peek: (s, i = 0) => readMap(s as MemoryState, i),
  poke: (s, i, v) => writeMap(s as MemoryState, i, v),
})

export const PROJECT5_CHIPS: ChipDef[] = [rom32k, screen, keyboard, memory]
