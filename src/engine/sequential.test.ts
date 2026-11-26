import { describe, expect, it } from 'vitest'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { CircuitError, simulate } from './simulate'
import { Simulator } from './sequential'
import { runExercise } from './exercise'
import { compareToCmp, parseTst, runTst } from './tst'

// ---------------------------------------------------------------------------
// Circuits built the way a student would: DFF + Mux (+ DMux/Mux8Way for RAM8).

/** Bit: out(t+1) = load ? in : out(t) */
function bitCircuit(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'in', 'in', 'input')
  c = addPin(c, 'load', 'load', 'input')
  c = addPin(c, 'out', 'out', 'output')
  c = addChip(c, 'mux', 'Mux')
  c = addChip(c, 'dff', 'DFF')
  c = connect(c, { chip: 'dff', pin: 'out' }, { chip: 'mux', pin: 'a' }) // feedback: keep old value
  c = connect(c, { pin: 'in' }, { chip: 'mux', pin: 'b' })
  c = connect(c, { pin: 'load' }, { chip: 'mux', pin: 'sel' })
  c = connect(c, { chip: 'mux', pin: 'out' }, { chip: 'dff', pin: 'in' })
  c = connect(c, { chip: 'dff', pin: 'out' }, { pin: 'out' })
  return c
}

/** Register: same as Bit but 16 bits wide (DFF16 stands in for 16 DFFs). */
function registerCircuit(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'in', 'in', 'input', 16)
  c = addPin(c, 'load', 'load', 'input')
  c = addPin(c, 'out', 'out', 'output', 16)
  c = addChip(c, 'mux', 'Mux16')
  c = addChip(c, 'dff', 'DFF16')
  c = connect(c, { chip: 'dff', pin: 'out' }, { chip: 'mux', pin: 'a' })
  c = connect(c, { pin: 'in' }, { chip: 'mux', pin: 'b' })
  c = connect(c, { pin: 'load' }, { chip: 'mux', pin: 'sel' })
  c = connect(c, { chip: 'mux', pin: 'out' }, { chip: 'dff', pin: 'in' })
  c = connect(c, { chip: 'dff', pin: 'out' }, { pin: 'out' })
  return c
}

/** RAM8: eight Registers, a DMux8Way to pick which one loads, a Mux8Way16 to pick which is read. */
function ram8Circuit(): Circuit {
  const L = 'abcdefgh'
  let c = emptyCircuit()
  c = addPin(c, 'in', 'in', 'input', 16)
  c = addPin(c, 'load', 'load', 'input')
  c = addPin(c, 'address', 'address', 'input', 3)
  c = addPin(c, 'out', 'out', 'output', 16)
  c = addChip(c, 'dm', 'DMux8Way')
  c = addChip(c, 'rd', 'Mux8Way16')
  c = connect(c, { pin: 'load' }, { chip: 'dm', pin: 'in' })
  c = connect(c, { pin: 'address' }, { chip: 'dm', pin: 'sel' })
  c = connect(c, { pin: 'address' }, { chip: 'rd', pin: 'sel' })
  for (let i = 0; i < 8; i++) {
    const mux = `mux${i}`
    const dff = `reg${i}`
    c = addChip(c, mux, 'Mux16')
    c = addChip(c, dff, 'DFF16')
    c = connect(c, { chip: dff, pin: 'out' }, { chip: mux, pin: 'a' })
    c = connect(c, { pin: 'in' }, { chip: mux, pin: 'b' })
    c = connect(c, { chip: 'dm', pin: L[i] }, { chip: mux, pin: 'sel' })
    c = connect(c, { chip: mux, pin: 'out' }, { chip: dff, pin: 'in' })
    c = connect(c, { chip: dff, pin: 'out' }, { chip: 'rd', pin: L[i] })
  }
  c = connect(c, { chip: 'rd', pin: 'out' }, { pin: 'out' })
  return c
}

/** Toggle: out flips every clock cycle (Not feeding a DFF that feeds the Not). */
function toggleCircuit(): Circuit {
  let c = emptyCircuit()
  c = addPin(c, 'out', 'out', 'output')
  c = addChip(c, 'not', 'Not')
  c = addChip(c, 'dff', 'DFF')
  c = connect(c, { chip: 'dff', pin: 'out' }, { chip: 'not', pin: 'in' })
  c = connect(c, { chip: 'not', pin: 'out' }, { chip: 'dff', pin: 'in' })
  c = connect(c, { chip: 'dff', pin: 'out' }, { pin: 'out' })
  return c
}

// ---------------------------------------------------------------------------
// Reference test scripts + expected output. The .cmp files are written by hand
// from the Bit / Register / RAM8 specs (time "0+" = after tick, "1" = after tock).

const BIT_TST = `
// Bit.tst
load Bit.hdl, output-file Bit.out, compare-to Bit.cmp,
output-list time%S1.4.1 in%B2.1.2 load%B2.1.2 out%B2.1.2;

set in 0, set load 0, tick, output; tock, output;
set load 1, tick, output; tock, output;
set in 1, set load 0, tick, output; tock, output;
set load 1, tick, output; tock, output;
set in 0, set load 0, tick, output; tock, output;
`
const BIT_CMP = `
|time | in |load| out |
| 0+  |  0 |  0 |  0  |
| 1   |  0 |  0 |  0  |
| 1+  |  0 |  1 |  0  |
| 2   |  0 |  1 |  0  |
| 2+  |  1 |  0 |  0  |
| 3   |  1 |  0 |  0  |
| 3+  |  1 |  1 |  0  |
| 4   |  1 |  1 |  1  |
| 4+  |  0 |  0 |  1  |
| 5   |  0 |  0 |  1  |
`

const REGISTER_TST = `
output-list time%S1.4.1 in%B1.16.1 load%B2.1.2 out%B1.16.1;
set in %B0000000000000001, set load 0, tick, output; tock, output;
set load 1, tick, output; tock, output;
set in %B1111111111111111, set load 0, tick, output; tock, output;
set load 1, tick, output; tock, output;
`
const REGISTER_CMP = `
|time |       in       |load|       out      |
| 0+  | 0000000000000001 |  0 | 0000000000000000 |
| 1   | 0000000000000001 |  0 | 0000000000000000 |
| 1+  | 0000000000000001 |  1 | 0000000000000000 |
| 2   | 0000000000000001 |  1 | 0000000000000001 |
| 2+  | 1111111111111111 |  0 | 0000000000000001 |
| 3   | 1111111111111111 |  0 | 0000000000000001 |
| 3+  | 1111111111111111 |  1 | 0000000000000001 |
| 4   | 1111111111111111 |  1 | 1111111111111111 |
`

const RAM8_TST = `
output-list time%S1.4.1 in%B1.16.1 load%B2.1.2 address%B3.3.1 out%B1.16.1;
set in %B0000000000000001, set load 1, set address 0, tick, output; tock, output;
set in %B0000000000000010, set address 1, tick, output; tock, output;
set load 0, set address 0, tick, output; tock, output;
set address 1, tick, output; tock, output;
`
const RAM8_CMP = `
|time |       in       |load|address|       out      |
| 0+  | 0000000000000001 |  1 | 000 | 0000000000000000 |
| 1   | 0000000000000001 |  1 | 000 | 0000000000000001 |
| 1+  | 0000000000000010 |  1 | 001 | 0000000000000000 |
| 2   | 0000000000000010 |  1 | 001 | 0000000000000010 |
| 2+  | 0000000000000010 |  0 | 000 | 0000000000000001 |
| 3   | 0000000000000010 |  0 | 000 | 0000000000000001 |
| 3+  | 0000000000000010 |  0 | 001 | 0000000000000010 |
| 4   | 0000000000000010 |  0 | 001 | 0000000000000010 |
`

function passes(circuit: Circuit, tstText: string, cmpText: string) {
  const out = runTst(circuit, parseTst(tstText))
  return compareToCmp(out.rows, cmpText)
}

describe('circuits built from DFF + Mux pass their .cmp files', () => {
  it('Bit', () => {
    const r = passes(bitCircuit(), BIT_TST, BIT_CMP)
    expect(r.message).toBeUndefined()
    expect(r.rows.filter((x) => !x.pass)).toEqual([])
    expect(r.pass).toBe(true)
  })

  it('Register', () => {
    const r = passes(registerCircuit(), REGISTER_TST, REGISTER_CMP)
    expect(r.rows.filter((x) => !x.pass)).toEqual([])
    expect(r.pass).toBe(true)
  })

  it('RAM8', () => {
    const r = passes(ram8Circuit(), RAM8_TST, RAM8_CMP)
    expect(r.rows.filter((x) => !x.pass)).toEqual([])
    expect(r.pass).toBe(true)
  })

  it('a wrong circuit is caught (Bit that ignores load)', () => {
    let c = bitCircuit()
    // Rewire mux.sel to constant-ish: drive sel from `in` instead of `load`.
    c = { ...c, wires: c.wires.map((w) => (w.id === 'w3' ? { ...w, from: { pin: 'in' } } : w)) }
    const r = passes(c, BIT_TST, BIT_CMP)
    expect(r.pass).toBe(false)
  })
})

describe('feedback loops', () => {
  it('a loop without a DFF is still an error', () => {
    let c = emptyCircuit()
    c = addPin(c, 'x', 'x', 'input')
    c = addPin(c, 'out', 'out', 'output')
    c = addChip(c, 'mux', 'Mux')
    c = connect(c, { chip: 'mux', pin: 'out' }, { chip: 'mux', pin: 'a' }) // out feeds itself
    c = connect(c, { pin: 'x' }, { chip: 'mux', pin: 'b' })
    c = connect(c, { pin: 'x' }, { chip: 'mux', pin: 'sel' })
    c = connect(c, { chip: 'mux', pin: 'out' }, { pin: 'out' })
    expect(() => new Simulator(c)).toThrow(CircuitError)
    expect(() => new Simulator(c)).toThrow(/Cycle detected.*mux/)
    expect(() => simulate(c, { x: 0 })).toThrow(/Cycle detected/)
  })

  it('a loop through the in input of a RAM is allowed (RAM out depends only on address)', () => {
    // CORRECTED SEMANTICS. This test used to expect an error for ram.out -> Inc16 -> ram.in, because the
    // engine treated every RAM input as combinational. In the Nand2Tetris simulator (and real hardware) a
    // RAM's in / load are only sampled at the clock tick; out = memory[address]. Only a loop through
    // ram.address is a real cycle (see tests/feedback.test.ts).
    let c = emptyCircuit()
    c = addPin(c, 'addr', 'addr', 'input', 6)
    c = addPin(c, 'w', 'w', 'input')
    c = addPin(c, 'out', 'out', 'output', 16)
    c = addChip(c, 'ram', 'RAM64')
    c = addChip(c, 'inc', 'Inc16')
    c = connect(c, { pin: 'addr' }, { chip: 'ram', pin: 'address' })
    c = connect(c, { pin: 'w' }, { chip: 'ram', pin: 'load' })
    c = connect(c, { chip: 'ram', pin: 'out' }, { chip: 'inc', pin: 'in' })
    c = connect(c, { chip: 'inc', pin: 'out' }, { chip: 'ram', pin: 'in' })
    c = connect(c, { chip: 'ram', pin: 'out' }, { pin: 'out' })
    const sim = new Simulator(c)
    for (let i = 0; i < 3; i++) sim.step({ addr: 9, w: 1 }) // memory[9] counts 1, 2, 3
    expect(sim.eval({ addr: 9, w: 0 }).outputs.out).toBe(3)
    expect(sim.eval({ addr: 10, w: 0 }).outputs.out).toBe(0)
  })

  it('a loop through a DFF is allowed and toggles every cycle', () => {
    const sim = new Simulator(toggleCircuit())
    const seen: number[] = [sim.eval({}).outputs.out]
    for (let i = 0; i < 4; i++) seen.push(sim.step({}).outputs.out)
    expect(seen).toEqual([0, 1, 0, 1, 0])
  })
})

describe('Simulator clock and state', () => {
  it('output changes only at tock, and time follows the 0, 0+, 1, 1+ pattern', () => {
    const sim = new Simulator(bitCircuit())
    const inp = { in: 1, load: 1 }
    expect(sim.time).toBe('0')
    expect(sim.tick(inp).outputs.out).toBe(0)
    expect(sim.time).toBe('0+')
    expect(sim.tock(inp).outputs.out).toBe(1)
    expect(sim.time).toBe('1')
    expect(sim.cycles).toBe(1)
  })

  it('a tock without a tick does nothing', () => {
    const sim = new Simulator(bitCircuit())
    sim.tock({ in: 1, load: 1 })
    expect(sim.time).toBe('0')
  })

  it('reset clears stored values and the clock', () => {
    const sim = new Simulator(bitCircuit())
    sim.step({ in: 1, load: 1 })
    expect(sim.eval({ in: 0, load: 0 }).outputs.out).toBe(1)
    sim.reset()
    expect(sim.eval({ in: 0, load: 0 }).outputs.out).toBe(0)
    expect(sim.time).toBe('0')
  })

  it('each chip instance keeps its own state', () => {
    let c = emptyCircuit()
    c = addPin(c, 'a', 'a', 'input')
    c = addPin(c, 'b', 'b', 'input')
    c = addPin(c, 'qa', 'qa', 'output')
    c = addPin(c, 'qb', 'qb', 'output')
    c = addChip(c, 'd1', 'DFF')
    c = addChip(c, 'd2', 'DFF')
    c = connect(c, { pin: 'a' }, { chip: 'd1', pin: 'in' })
    c = connect(c, { pin: 'b' }, { chip: 'd2', pin: 'in' })
    c = connect(c, { chip: 'd1', pin: 'out' }, { pin: 'qa' })
    c = connect(c, { chip: 'd2', pin: 'out' }, { pin: 'qb' })
    const sim = new Simulator(c)
    expect(sim.step({ a: 1, b: 0 }).outputs).toEqual({ qa: 1, qb: 0 })
    expect(sim.stored()).toEqual({ d1: 1, d2: 0 })
  })
})

describe('built-in memory chips', () => {
  function single(type: string, ins: [string, number][], outW: number): Circuit {
    let c = emptyCircuit()
    c = addPin(c, 'out', 'out', 'output', outW)
    c = addChip(c, 'u', type)
    for (const [name, w] of ins) {
      c = addPin(c, name, name, 'input', w)
      c = connect(c, { pin: name }, { chip: 'u', pin: name })
    }
    return connect(c, { chip: 'u', pin: 'out' }, { pin: 'out' })
  }

  it('RAM64 writes at tock and reads combinationally', () => {
    const sim = new Simulator(single('RAM64', [['in', 16], ['load', 1], ['address', 6]], 16))
    sim.step({ in: 1234, load: 1, address: 63 })
    sim.step({ in: 99, load: 1, address: 0 })
    expect(sim.eval({ in: 0, load: 0, address: 63 }).outputs.out).toBe(1234)
    expect(sim.eval({ in: 0, load: 0, address: 0 }).outputs.out).toBe(99)
    expect(sim.eval({ in: 0, load: 0, address: 5 }).outputs.out).toBe(0)
    // load = 0 must not write
    sim.step({ in: 7, load: 0, address: 5 })
    expect(sim.eval({ in: 0, load: 0, address: 5 }).outputs.out).toBe(0)
  })

  it('RAM64 write is not visible until tock', () => {
    const sim = new Simulator(single('RAM64', [['in', 16], ['load', 1], ['address', 6]], 16))
    const inp = { in: 5, load: 1, address: 2 }
    expect(sim.tick(inp).outputs.out).toBe(0)
    expect(sim.tock(inp).outputs.out).toBe(5)
  })

  it.each([['RAM512', 9], ['RAM4K', 12], ['RAM16K', 14]])('%s uses the full %i-bit address range', (type, bits) => {
    const sim = new Simulator(single(type, [['in', 16], ['load', 1], ['address', bits]], 16))
    const top = (1 << bits) - 1
    sim.step({ in: 4242, load: 1, address: top })
    expect(sim.eval({ in: 0, load: 0, address: top }).outputs.out).toBe(4242)
    expect(sim.eval({ in: 0, load: 0, address: 0 }).outputs.out).toBe(0)
  })

  it('PC: inc, load, hold, and reset > load > inc priority', () => {
    const sim = new Simulator(
      single('PC', [['in', 16], ['load', 1], ['inc', 1], ['reset', 1]], 16),
    )
    const s = (inn: number, load: number, inc: number, reset: number) =>
      sim.step({ in: inn, load, inc, reset }).outputs.out
    expect(s(0, 0, 1, 0)).toBe(1)
    expect(s(0, 0, 1, 0)).toBe(2)
    expect(s(0, 0, 0, 0)).toBe(2) // hold
    expect(s(100, 1, 1, 0)).toBe(100) // load beats inc
    expect(s(50, 1, 1, 1)).toBe(0) // reset beats load
    expect(s(0xffff, 1, 0, 0)).toBe(0xffff)
    expect(s(0, 0, 1, 0)).toBe(0) // wraps at 16 bits
  })
})

describe('.tst parser and runner', () => {
  it('parses set formats, comments and repeat', () => {
    const t = parseTst(`
      // comment
      output-list time%S1.4.1 out%B2.1.2; /* block */
      set a 5, set b %B101, set c %X1F, set d -1, set e %D7;
      repeat 2 { tick, tock; repeat 3 { eval; } }
    `)
    expect(t.outputList.map((c) => c.name)).toEqual(['time', 'out'])
    const sets = t.commands.filter((c) => c.op === 'set').map((c) => (c.op === 'set' ? c.value : 0))
    expect(sets).toEqual([5, 5, 31, -1, 7])
    const rep = t.commands.find((c) => c.op === 'repeat')
    expect(rep && rep.op === 'repeat' && rep.count).toBe(2)
  })

  it('repeat N { tick, tock } advances N clock cycles', () => {
    const tst = parseTst('output-list time%S1.4.1 out%B2.1.2; output; repeat 3 { tick, tock; } output; repeat 2 { tick, output; tock, output; }')
    const out = runTst(toggleCircuit(), tst)
    expect(out.rows.map((r) => r.split('|').slice(1, -1).map((s) => s.trim()))).toEqual([
      ['0', '0'],
      ['3', '1'], // 0 -> 1 -> 0 -> 1
      ['3+', '1'],
      ['4', '0'],
      ['4+', '0'],
      ['5', '1'],
    ])
  })

  it('reports parse errors clearly', () => {
    expect(() => parseTst('repeat 3 { tick')).toThrow(/Missing "}"/)
    expect(() => parseTst('repeat { tick }')).toThrow(/needs a number/)
    expect(() => parseTst('set in banana')).toThrow(/Bad value/)
    expect(() => parseTst('output-list out%Q1.1.1;')).toThrow(/Bad output-list/)
    expect(() => parseTst('tick; }')).toThrow(/Unexpected "}"/)
  })

  it('ticktock is tick followed by tock (and is not reported as an unknown command)', () => {
    const t = parseTst('output-list time%S1.4.1 out%B1.1.1; repeat 3 { ticktock; } output;')
    expect(t.warnings).toEqual([])
    const out = runTst(toggleCircuit(), t)
    // 3 full cycles: time 3, and the toggle went 0 -> 1 -> 0 -> 1
    expect(out.rows[0].split('|').slice(1, -1).map((s) => s.trim())).toEqual(['3', '1'])
  })

  it('a second output-list REPLACES the active columns (rows use the list in effect)', () => {
    let c = emptyCircuit()
    c = addPin(c, 'a', 'a', 'input')
    c = addPin(c, 'b', 'b', 'input')
    const t = parseTst(
      'output-list a%B1.1.1 b%B1.1.1; set a 1, set b 0, output; output-list b%B1.1.1; output;',
    )
    expect(t.outputList.map((col) => col.name)).toEqual(['b']) // the list that is active at the end
    expect(runTst(c, t).rows).toEqual(['| 1 | 0 |', '| 0 |'])
  })

  describe('warnings instead of silent truncation', () => {
    const pins = () => {
      let c = emptyCircuit()
      c = addPin(c, 'sel', 'sel', 'input', 2)
      c = addPin(c, 'w', 'w', 'input', 16)
      c = addPin(c, 'x', 'x', 'input', 4)
      return c
    }
    const warningsOf = (script: string) => runTst(pins(), parseTst(script)).warnings

    it('set with a value that does not fit the pin width warns (and says what it was cut to)', () => {
      const w = warningsOf('set sel 5; set w 70000; set sel -3;')
      expect(w).toHaveLength(3)
      expect(w[0]).toMatch(/set sel 5: .*does not fit in 2 bits.*cut to 1/)
      expect(w[1]).toMatch(/set w 70000: .*16 bits/)
      expect(w[2]).toMatch(/set sel -3/)
    })

    it('values that fit never warn, including negative numbers (two\'s complement) and the largest value', () => {
      expect(warningsOf('set sel 3; set sel 0; set sel -2; set w -1; set w 65535; set w %B1111111111111111; set x %XF;')).toEqual([])
    })

    it('the same warning is reported once, even inside a long repeat', () => {
      expect(warningsOf('repeat 100 { set sel 5; }')).toHaveLength(1)
    })

    it('%B / %X that cut off digits warn; wide enough columns do not', () => {
      // x = 12 = %B1100 (4 digits) = 0xC (1 digit)
      const cut = warningsOf('output-list x%B1.2.1 x%X1.1.1; set x 12; output;')
      expect(cut).toHaveLength(1) // only %B1.2.1 cuts digits; one hex digit is enough for 0xC
      expect(cut[0]).toMatch(/x%B1\.2\.1: value 12 needs 4 digits but only 2 are shown/)
      // w = 255 = 0xFF needs 2 hex digits
      expect(warningsOf('output-list w%X1.1.1; set w 255; output;')[0]).toMatch(/w%X1\.1\.1: value 255 needs 2 digits but only 1 is shown/)
      expect(warningsOf('output-list x%B1.4.1 w%X1.4.1 w%D1.6.1; set x 12, set w 255; output;')).toEqual([])
    })

    it('runExercise reports these warnings together with the parser warnings', () => {
      const run = runExercise(pins(), 'output-list x%B1.2.1; frob; set x 12; output;', '|x|\n| 00 |')
      expect(run.warnings).toHaveLength(2)
      expect(run.warnings[0]).toMatch(/Unknown command "frob"/)
      expect(run.warnings[1]).toMatch(/needs 4 digits/)
    })
  })

  it('unknown commands become warnings and are skipped (including their { } block)', () => {
    const t = parseTst('frobnicate 1 2; while out = 0 { tick, repeat 2 { tock; } } set a 1; tick;')
    expect(t.warnings).toEqual(['Unknown command "frobnicate" was ignored', 'Unknown command "while" was ignored'])
    expect(t.commands.map((c) => c.op)).toEqual(['set', 'tick'])
  })

  it('bus indexing in set is still an error (skipping it would hide wrong results)', () => {
    expect(() => parseTst('set a[0] 1;')).toThrow(/Bus indexing/)
  })

  it('reports unknown pins at run time', () => {
    const t = parseTst('output-list nope%B1.1.1; output;')
    expect(() => runTst(toggleCircuit(), t)).toThrow(/unknown pin "nope"/)
    expect(() => runTst(toggleCircuit(), parseTst('set zzz 1;'))).toThrow(/not an input pin/)
  })

  it('stops runaway scripts instead of hanging', () => {
    const t = parseTst('repeat 999999999 { tick, tock; }')
    expect(() => runTst(toggleCircuit(), t)).toThrow(/too long/)
    // Runs a million clock cycles (about 4 s alone); the default 5 s limit fails when all test files run in parallel.
  }, 30_000)

  it('compareToCmp flags the wrong row and a wrong row count', () => {
    const bad = BIT_CMP.replace('| 4   |  1 |  1 |  1  |', '| 4   |  1 |  1 |  0  |')
    const r = passes(bitCircuit(), BIT_TST, bad)
    expect(r.pass).toBe(false)
    expect(r.rows.filter((x) => !x.pass).map((x) => x.index)).toEqual([7])
    const short = compareToCmp(['| 0 |'], '| a |\n| 0 |\n| 1 |')
    expect(short.pass).toBe(false)
    expect(short.message).toMatch(/1 rows, .cmp has 2/)
  })
})
