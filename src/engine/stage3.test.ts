// Project 5 stage 3: the official .tst / .cmp FORMAT features and internal state in scripts.
// Every fixture below is invented (small chips and scripts that reproduce the same features); the course files
// themselves are only used by tests/official.test.ts, which is skipped when they are not on this machine.
import { describe, expect, it } from 'vitest'
import { assemble } from '../../tests/helpers/asm'
import { CHIPS } from './chips'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { runExercise } from './exercise'
import { Simulator } from './sequential'
import { CircuitError } from './simulate'
import { compareToCmp, parseTst, runTst, TstParseError } from './tst'

/** One chip with every pin wired to a circuit pin of the same name. */
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

const run = (c: Circuit, script: string, opts?: Parameters<typeof runTst>[2]) => runTst(c, parseTst(script), opts)
const cells = (row: string) => row.split('|').slice(1, -1).map((s) => s.trim())

describe('1. the time pseudo-variable', () => {
  it('counts tocks: "0" at the start, "0+" after a tick, "1" after the tock, "1+" after the next tick', () => {
    const out = run(
      single('Register'),
      'output-list time%S0.4.0 out%D1.3.1; set in 3, set load 1, output; tick, output; tock, output; tick, output; tock, output;',
    )
    expect(out.rows.map((r) => cells(r)[0])).toEqual(['0', '0+', '1', '1+', '2'])
    expect(out.rows[1].startsWith('|0+  |')).toBe(true) // %S0.4.0 = 4 characters, left-aligned
    expect(cells(out.rows[2])[1]).toBe('3') // the register holds 3 after the first tock
  })
  it('works with padding (time%S1.3.1) and with ticktock', () => {
    const out = run(single('Register'), 'output-list time%S1.3.1; ticktock, output;')
    expect(out.rows).toEqual(['| 1   |'])
  })
})

describe('2. a "*" run in a .cmp cell accepts any value', () => {
  it('stars match anything, other cells still have to match', () => {
    expect(compareToCmp(['|  7  |  1234 |'], '|a|b|\n|  7  |*******|').pass).toBe(true)
    expect(compareToCmp(['|  7  |  1234 |'], '|a|b|\n|  8  |*******|').pass).toBe(false)
    expect(compareToCmp(['|  7  |  1234 |'], '|a|b|\n|  7  |  *  |').rows[0].pass).toBe(true)
  })
  it('a different number of cells never passes', () => {
    expect(compareToCmp(['| 7 | 1 |'], '|a|\n| * |').pass).toBe(false)
  })
  it('works through runExercise on a real circuit', () => {
    const r = runExercise(single('Register'), 'output-list in%D1.3.1 out%D1.3.1; set in 9, eval, output;', '|in|out|\n| 9 | *** |')
    expect(r.passed).toBe(1)
  })
})

describe('3. .cmp header names are cut to the column width: columns match by position', () => {
  it('ignores header text completely', () => {
    const r = runExercise(
      single('Register'),
      'output-list time%S0.4.0 in%D1.3.1 out%D1.3.1; set in 2, output;',
      '|ti|in|ou|\n|0   |  2|  0|',
    )
    expect(r.passed).toBe(1)
    expect(r.columns).toEqual(['time', 'in', 'out'])
  })
  it('a truncated name is not an error even when it would match nothing', () => {
    expect(compareToCmp(['| 1 |'], '|DRegiste|\n| 1 |').pass).toBe(true)
  })
})

describe('4. set values with base prefixes and negatives', () => {
  it('parses %B, %X, %D, plain and negative values', () => {
    const t = parseTst('set a %B0011000000111001, set b %X2000, set c %D123, set d -5, set e %D-7;')
    const values = t.commands.map((c) => (c.op === 'set' ? c.value : NaN))
    expect(values).toEqual([0x3039, 0x2000, 123, -5, -7])
  })
  it('a negative decimal becomes its two\'s complement on a 16-bit pin, without a warning', () => {
    const out = run(single('Register'), 'output-list in%D1.6.1 in%X1.4.1 in%B1.16.1; set in -2, output;')
    expect(cells(out.rows[0])).toEqual(['-2', 'FFFE', '1111111111111110'])
    expect(out.warnings).toEqual([])
  })
  it('a bad value is a parse error', () => {
    expect(() => parseTst('set a %Q12;')).toThrow(TstParseError)
  })
})

describe('5. while loops', () => {
  it('while out < 5 clocks a counter until the condition is false', () => {
    const pc = single('PC')
    const out = run(pc, 'output-list out%D1.3.1; set inc 1, while out < 5 { tick, tock, } output;')
    expect(cells(out.rows[0])).toEqual(['5'])
    expect(out.stopped).toBeUndefined()
  })
  // A Register holds 3; the loop body loads 0. If the condition is true at the start the body runs once and out
  // becomes 0 (the condition is then false for every case below); otherwise out stays 3.
  it.each([
    ['=', '3', '0'],
    ['<>', '3', '3'],
    ['<=', '2', '3'],
    ['>=', '3', '0'],
    ['>', '2', '0'],
    ['<', '3', '3'], // 3 < 3 is false at once
    ['<', '-1', '3'], // 3 is not below -1 (signed compare)
  ])('operator %s %s: out ends as %s', (op, rhs, expected) => {
    const out = run(
      single('Register'),
      `output-list out%D1.3.1; set in 3, set load 1, ticktock, set in 0, while out ${op} ${rhs} { tick, tock, } output;`,
    )
    expect(cells(out.rows[0])).toEqual([expected])
  })
  it('a 16-bit value is compared as signed for < and > (65535 is -1)', () => {
    const out = run(
      single('Register'),
      'output-list out%D1.3.1; set in -1, set load 1, ticktock, set in 0, while out < 0 { tick, tock, } output;',
    )
    expect(cells(out.rows[0])).toEqual(['0'])
  })
  it('the condition may be written without spaces (out<>75)', () => {
    const t = parseTst('while out<>75 { tick, }')
    expect(t.commands[0]).toMatchObject({ op: 'while', cmp: '<>', value: 75 })
  })
  it('a while that never ends stops the script with a message and KEEPS the earlier rows', () => {
    const script =
      'output-list out%D1.3.1; output; echo "Hold the K key"; while out <> 75 { tick, tock, } output;'
    const out = run(single('Register'), script)
    expect(out.rows).toHaveLength(1) // the first output; the second one was never reached
    expect(out.stopped).toMatch(/while out <> 75/)
    expect(out.stopped).toMatch(/key box of the Keyboard block/)
    expect(out.stopped).toMatch(/Hold the K key/) // names the step the script was waiting at
    expect(out.info).toEqual(['Hold the K key'])
  })
  it('runExercise reports it in the message, the passed rows stay', () => {
    const r = runExercise(
      single('Register'),
      'output-list out%D1.3.1; output; while out <> 75 { tick, } output;',
      '|out|\n|  0|\n| 75|',
    )
    expect(r.rows[0].pass).toBe(true)
    expect(r.rows[1].actual).toBe('(no row)')
    expect(r.message).toMatch(/The script was stopped/)
    expect(r.passed).toBe(1)
  })
  it('the Keyboard key box makes the official waiting loop pass (key held from the start)', () => {
    const mem = single('Memory', { key: 75 })
    const out = run(mem, 'output-list out%D1.6.1; set address 24576, while out <> 75 { tick, tock, } output;')
    expect(cells(out.rows[0])).toEqual(['75'])
    expect(out.stopped).toBeUndefined()
  })
  it('while counts against the shared iteration cap, and nesting is bounded', () => {
    expect(() => parseTst('while a = 1 {'.repeat(150) + '}'.repeat(150))).toThrow(/nested too deeply/)
  })
})

describe('6. echo, clear-echo and the ignored commands', () => {
  it('echo text becomes an info line (commas, semicolons and // inside the quotes are harmless)', () => {
    const out = run(single('Register'), 'echo "Select View, then Screen; then // run";\nclear-echo;\noutput-list out%D1.3.1; output;')
    expect(out.info).toEqual(['Select View, then Screen; then // run'])
    expect(out.warnings).toEqual([])
    expect(out.rows).toHaveLength(1)
  })
  it('the course header (load / output-file / compare-to) gives one grey notice each (no warning) and never fails', () => {
    const t = parseTst('load Foo.hdl,\noutput-file Foo.out,\ncompare-to Foo.cmp,\noutput-list in%D1.3.1;\nset in 1, output;')
    expect(t.warnings).toEqual([])
    expect(t.notices).toHaveLength(3)
    expect(t.notices[0]).toMatch(/"load Foo\.hdl" was ignored/)
    expect(t.notices[1]).toMatch(/"output-file Foo\.out" was ignored/)
    expect(t.notices[2]).toMatch(/"compare-to Foo\.cmp" was ignored/)
    expect(run(single('Register'), 'load Foo.hdl, output-list in%D1.3.1; set in 1, output;').rows).toHaveLength(1)
  })
  it('an unterminated quote ends at the end of its line instead of eating the script', () => {
    const t = parseTst('echo "oops\n; output-list in%D1.3.1;\noutput;')
    expect(t.commands.map((c) => c.op)).toEqual(['echo', 'output-list', 'output'])
  })
})

describe('7. internal state, resolved by chip type', () => {
  describe('memories and registers placed on the board', () => {
    it('set RAM16K[3] 5 then read it through the address pin, and output RAM16K[3]', () => {
      const out = run(
        single('RAM16K'),
        'output-list address%D1.2.1 out%D1.6.1 RAM16K[3]%D1.6.1 RAM16K[4]%D1.6.1; set RAM16K[3] 5, set address 3, eval, output;',
      )
      expect(cells(out.rows[0])).toEqual(['3', '5', '5', '0'])
    })
    it('clocked writes show in RAM16K[i]; a negative set is stored as 16 bits', () => {
      const out = run(
        single('RAM16K'),
        'output-list RAM16K[7]%D1.6.1 RAM16K[7]%X1.4.1; set in -1, set load 1, set address 7, tick, tock, output;',
      )
      expect(cells(out.rows[0])).toEqual(['-1', 'FFFF'])
    })
    it('PC[] and DRegister[] / ARegister[] (and the [0] form) on single registers', () => {
      const pc = run(single('PC'), 'output-list out%D1.3.1 PC[]%D1.3.1; set PC[] 9, eval, output;')
      expect(cells(pc.rows[0])).toEqual(['9', '9'])
      const d = run(single('DRegister'), 'output-list out%D1.3.1 DRegister[]%D1.3.1 DRegister[0]%D1.3.1; set DRegister[] 4, eval, output;')
      expect(cells(d.rows[0])).toEqual(['4', '4', '4'])
      const a = run(single('ARegister'), 'output-list ARegister[0]%D1.3.1 ARegister[]%D1.3.1; set ARegister[0] 6, output;')
      expect(cells(a.rows[0])).toEqual(['6', '6'])
    })
    it('a poke wins over a value latched by a tick that has no tock yet', () => {
      const out = run(single('Register'), 'output-list Register[]%D1.3.1; set in 5, set load 1, tick, set Register[] 8, tock, output;')
      expect(cells(out.rows[0])).toEqual(['8'])
    })
    it('Screen[i] and Memory[i] on blocks', () => {
      const s = run(single('Screen'), 'output-list Screen[5]%D1.6.1 out%D1.6.1; set Screen[5] 77, set address 5, eval, output;')
      expect(cells(s.rows[0])).toEqual(['77', '77'])
      const m = run(single('Memory'), 'output-list Memory[16389]%D1.6.1 Memory[3]%D1.6.1; set Memory[16389] 3, set Memory[3] 4, output;')
      expect(cells(m.rows[0])).toEqual(['3', '4'])
    })
    it('Keyboard[] sets the key; Keyboard[] also reaches the key of a Memory block', () => {
      const k = run(single('Keyboard'), 'output-list out%D1.3.1 Keyboard[]%D1.3.1; set Keyboard[] 75, output;')
      expect(cells(k.rows[0])).toEqual(['75', '75'])
      const m = run(single('Memory'), 'output-list out%D1.3.1; set address 24576, set Keyboard[] 89, eval, output;')
      expect(cells(m.rows[0])).toEqual(['89'])
    })
  })

  describe('inside the built-in CPU and Computer', () => {
    it('CPU: ARegister[] / DRegister[] / PC[] follow @7 then D=A', () => {
      const [a7, dA] = assemble(['@7', 'D=A'])
      const out = run(
        single('CPU'),
        `output-list time%S0.4.0 ARegister[]%D1.3.1 DRegister[]%D1.3.1 PC[]%D1.3.1;
         set instruction ${a7}, tick, tock, output;
         set instruction ${dA}, tick, tock, output;`,
      )
      expect(out.rows.map(cells)).toEqual([['1', '7', '0', '1'], ['2', '7', '7', '2']])
    })
    it('Computer: ROM32K load, RAM16K[i], Screen[i], reset, and set PC[] / RAM16K[] before the run', () => {
      const prog = assemble(['@2', 'D=A', '@3', 'D=D+A', '@0', 'M=D', '@6', '0;JMP'])
      const script = `ROM32K load Add.hack,
        output-list time%S1.3.1 reset%B2.1.2 ARegister[0]%D1.3.1 DRegister[0]%D1.3.1 PC[]%D0.3.0 RAM16K[0]%D1.3.1 RAM16K[1]%D1.3.1;
        set RAM16K[1] 9, output;
        repeat 6 { tick, tock, output; }
        set reset 1, set RAM16K[0] 0, tick, tock, output;
        set reset 0, tick, tock, output;`
      const out = run(single('Computer'), script, { programs: new Map([['add.hack', prog]]) }) // file name case does not matter
      const rows = out.rows.map(cells)
      expect(rows[0]).toEqual(['0', '0', '0', '0', '0', '0', '9'])
      expect(rows[6]).toEqual(['6', '0', '0', '5', '6', '5', '9']) // A=0 (@0), D=5, PC=6, RAM[0]=5 after 6 instructions
      expect(rows[7]).toEqual(['7', '1', '6', '5', '0', '0', '9']) // reset: PC = 0, RAM[0] cleared by the script
      expect(rows[8]).toEqual(['8', '0', '2', '5', '1', '0', '9']) // runs again from 0: @2
    })
    it('Screen[i] reaches the Screen inside a Computer (memory map 16384 + i)', () => {
      const prog = assemble(['@7', 'D=A', '@16385', 'M=D', '@4', '0;JMP'])
      const out = run(single('Computer'), 'ROM32K load P.hack, output-list Screen[1]%D1.3.1 RAM16K[1]%D1.3.1; repeat 4 { tick, tock, } output;', {
        programs: new Map([['P.hack', prog]]),
      })
      expect(cells(out.rows[0])).toEqual(['7', '0'])
    })
    it('Keyboard[] inside a Computer sets the key the program reads at address 24576', () => {
      const prog = assemble(['@24576', 'D=M', '@0', 'M=D', '@4', '0;JMP'])
      const out = run(single('Computer'), 'ROM32K load P.hack, set Keyboard[] 75, output-list RAM16K[0]%D1.3.1; repeat 4 { tick, tock, } output;', {
        programs: new Map([['P.hack', prog]]),
      })
      expect(cells(out.rows[0])).toEqual(['75'])
    })
    it('a missing program file is a clear error pointing to Load files', () => {
      expect(() => run(single('Computer'), 'ROM32K load Nope.hack, output-list time%S1.3.1; output;')).toThrow(/Nope\.hack.*not loaded/)
    })
    it('ROM32K load on a circuit without any ROM32K or Computer is an error', () => {
      expect(() => run(single('Register'), 'ROM32K load P.hack,', { programs: new Map([['P.hack', [1]]]) })).toThrow(CircuitError)
    })
  })

  describe('errors', () => {
    it('no DRegister / ARegister block: tells the user to use the DRegister / ARegister block, not Register', () => {
      for (const t of ['DRegister', 'ARegister']) {
        expect(() => run(single('Register'), `output-list ${t}[]%D1.3.1; output;`)).toThrow(new RegExp(`${t} block.*not a generic Register`))
      }
    })
    it('a type that is not in the circuit at all', () => {
      expect(() => run(single('Register'), 'output-list RAM16K[0]%D1.3.1; output;')).toThrow(/no RAM16K/)
    })
    it('two instances at the same depth: an error that lists both', () => {
      let c = emptyCircuit()
      c = addChip(c, 'r1', 'RAM8')
      c = addChip(c, 'r2', 'RAM8')
      for (const id of ['r1', 'r2']) {
        for (const p of CHIPS.RAM8.inputs) {
          c = addPin(c, `${id}_${p.name}`, `${id}_${p.name}`, 'input', p.width)
          c = connect(c, { pin: `${id}_${p.name}` }, { chip: id, pin: p.name })
        }
        c = addPin(c, `${id}_o`, `${id}_out`, 'output', 16)
        c = connect(c, { chip: id, pin: 'out' }, { pin: `${id}_o` })
      }
      expect(() => run(c, 'output-list RAM8[1]%D1.3.1; output;')).toThrow(/2 of them.*"r1".*"r2"/)
    })
    it('the shallowest instance wins: a RAM16K block beats the RAM16K inside a Computer', () => {
      let c = single('Computer')
      c = addChip(c, 'extra', 'RAM16K')
      for (const p of CHIPS.RAM16K.inputs) {
        c = addPin(c, `x_${p.name}`, `x_${p.name}`, 'input', p.width)
        c = connect(c, { pin: `x_${p.name}` }, { chip: 'extra', pin: p.name })
      }
      c = addPin(c, 'x_o', 'x_out', 'output', 16)
      c = connect(c, { chip: 'extra', pin: 'out' }, { pin: 'x_o' })
      const out = run(c, 'output-list x_out%D1.3.1 RAM16K[2]%D1.3.1; set RAM16K[2] 6, set x_address 2, eval, output;')
      expect(cells(out.rows[0])).toEqual(['6', '6']) // went to the block, not to the Computer
    })
    it('a pin with the same name wins over a state name (and indexing a pin is the old bus-indexing error)', () => {
      let c = emptyCircuit()
      c = addPin(c, 'p', 'PC', 'input', 1)
      c = addPin(c, 'q', 'out', 'output', 1)
      c = addChip(c, 'n', 'Not')
      c = connect(c, { pin: 'p' }, { chip: 'n', pin: 'in' })
      c = connect(c, { chip: 'n', pin: 'out' }, { pin: 'q' })
      expect(cells(run(c, 'output-list PC%B1.1.1 out%B1.1.1; set PC 1, output;').rows[0])).toEqual(['1', '0'])
      expect(() => run(c, 'output-list out%B1.1.1; set PC[] 1, output;')).toThrow(/bus indexing "PC\[\]"/)
    })
    it('index problems: out of range, [] on a memory, a number on a single register, writing a ROM32K', () => {
      expect(() => run(single('RAM16K'), 'set RAM16K[16384] 1;')).toThrow(/outside this RAM16K \(0\.\.16383\)/)
      expect(() => run(single('RAM16K'), 'set RAM16K[] 1;')).toThrow(/write RAM16K\[address\]/)
      expect(() => run(single('PC'), 'set PC[2] 1;')).toThrow(/holds one value/)
      expect(() => run(single('ROM32K'), 'set ROM32K[0] 1;')).toThrow(/read-only/)
    })
    it('a value that does not fit is cut and reported once, for state too', () => {
      const out = run(single('RAM16K'), 'output-list RAM16K[0]%D1.6.1; set RAM16K[0] 70000, output;')
      expect(out.warnings).toHaveLength(1)
      expect(out.warnings[0]).toMatch(/set RAM16K\[0\] 70000: .*16 bits.*cut to 4464/)
    })
    it('indexing a name that is no chip type is still a parse error', () => {
      expect(() => parseTst('set a[0] 1;')).toThrow(/Bus indexing/)
      expect(() => parseTst('output-list a[0]%B1.1.1;')).toThrow(/Bus indexing/)
    })
  })
})

describe('registers show the value latched at the tick (course CPU.cmp has D already new at time "1+")', () => {
  const [a12, dA] = assemble(['@12', 'D=A'])
  it('built-in CPU: DRegister[] is new after the tick, the pins addressM / pc only after the tock', () => {
    const out = run(
      single('CPU'),
      `output-list time%S0.4.0 addressM%D1.3.1 pc%D1.3.1 ARegister[]%D1.3.1 DRegister[]%D1.3.1;
       set instruction ${a12}, tick, tock, set instruction ${dA}, tick, output; tock, output;`,
    )
    expect(out.rows.map(cells)).toEqual([
      ['1+', '12', '1', '12', '12'], // D=A at 1+: D is already 12, the pins still show the old state
      ['2', '12', '2', '12', '12'],
    ])
  })
  it('a user-built D register (DRegister block) behaves the same', () => {
    const out = run(single('DRegister'), 'output-list time%S0.4.0 out%D1.3.1 DRegister[]%D1.3.1; set in 5, set load 1, tick, output; tock, output;')
    expect(out.rows.map(cells)).toEqual([['0+', '0', '5'], ['1', '5', '5']])
  })
})

describe('10. replay rebuilds the wire values of one row', () => {
  const lines = (...rows: string[]) => rows.join(String.fromCharCode(10))
  it('the snapshot of row i holds the pin values and every wire value at that moment', () => {
    const r = runExercise(
      single('Register'),
      'output-list time%S0.4.0 out%D1.3.1; set in 7, set load 1, output; tick, output; tock, output;',
      lines('|t|o|', '|0|0|', '|0+|0|', '|1|7|'),
    )
    expect(r.passed).toBe(3)
    expect(r.rows[0]).toEqual({ index: 0, pass: true, expected: '0 | 0', actual: '0 | 0' }) // text and a flag only
    const s = r.replay(2)!
    expect(s.time).toBe('1')
    expect(s.inputs).toEqual({ in: 7, load: 1 })
    expect(s.outputs).toEqual({ out: 7 })
    expect(Object.values(s.wireValues).sort()).toEqual([1, 7, 7]) // in -> u.in, load -> u.load, u.out -> out
    expect(r.replay(0)!.outputs.out).toBe(0)
    expect(r.replay(3)).toBeUndefined()
  })
  it('replay of a row after a while loop gives the same values as the first run', () => {
    const script = 'output-list out%D1.3.1; set in 3, set load 1, tick, tock, output; set in 0, while out <> 0 { tick, tock, } output;'
    const r = runExercise(single('Register'), script, lines('|o|', '|3|', '|0|'))
    expect(r.replay(0)!.outputs.out).toBe(3)
    expect(r.replay(1)!.outputs.out).toBe(0)
  })
})

describe('8. a user-built Memory is tested with the same script as the built-in one', () => {
  /** Memory built from RAM16K + Screen + Keyboard blocks and a few gates (the course's Memory.hdl structure). */
  function userMemory(key = 0): Circuit {
    let c = emptyCircuit()
    c = addPin(c, 'in', 'in', 'input', 16)
    c = addPin(c, 'load', 'load', 'input', 1)
    c = addPin(c, 'address', 'address', 'input', 15)
    c = addPin(c, 'out', 'out', 'output', 16)
    c = addChip(c, 'sp', 'Split', {
      width: 15,
      ranges: [{ lo: 0, hi: 13 }, { lo: 0, hi: 12 }, { lo: 13, hi: 13 }, { lo: 14, hi: 14 }],
    })
    for (const [id, type] of [['nb14', 'Not'], ['nb13', 'Not'], ['lramA', 'And'], ['hi', 'And'], ['lscr', 'And'], ['ram', 'RAM16K'], ['scr', 'Screen'], ['kb', 'Keyboard'], ['m1', 'Mux16'], ['m2', 'Mux16']]) {
      c = addChip(c, id, type)
    }
    c.chips.find((x) => x.id === 'kb')!.key = key
    const w = (from: { pin: string } | { chip: string; pin: string }, to: { pin: string } | { chip: string; pin: string }) => (c = connect(c, from, to))
    w({ pin: 'address' }, { chip: 'sp', pin: 'in' })
    w({ chip: 'sp', pin: '[14]' }, { chip: 'nb14', pin: 'in' })
    w({ chip: 'sp', pin: '[13]' }, { chip: 'nb13', pin: 'in' })
    w({ pin: 'load' }, { chip: 'lramA', pin: 'a' })
    w({ chip: 'nb14', pin: 'out' }, { chip: 'lramA', pin: 'b' })
    w({ pin: 'load' }, { chip: 'hi', pin: 'a' })
    w({ chip: 'sp', pin: '[14]' }, { chip: 'hi', pin: 'b' })
    w({ chip: 'hi', pin: 'out' }, { chip: 'lscr', pin: 'a' })
    w({ chip: 'nb13', pin: 'out' }, { chip: 'lscr', pin: 'b' })
    w({ pin: 'in' }, { chip: 'ram', pin: 'in' })
    w({ chip: 'lramA', pin: 'out' }, { chip: 'ram', pin: 'load' })
    w({ chip: 'sp', pin: '[0..13]' }, { chip: 'ram', pin: 'address' })
    w({ pin: 'in' }, { chip: 'scr', pin: 'in' })
    w({ chip: 'lscr', pin: 'out' }, { chip: 'scr', pin: 'load' })
    w({ chip: 'sp', pin: '[0..12]' }, { chip: 'scr', pin: 'address' })
    w({ chip: 'scr', pin: 'out' }, { chip: 'm1', pin: 'a' })
    w({ chip: 'kb', pin: 'out' }, { chip: 'm1', pin: 'b' })
    w({ chip: 'sp', pin: '[13]' }, { chip: 'm1', pin: 'sel' })
    w({ chip: 'ram', pin: 'out' }, { chip: 'm2', pin: 'a' })
    w({ chip: 'm1', pin: 'out' }, { chip: 'm2', pin: 'b' })
    w({ chip: 'sp', pin: '[14]' }, { chip: 'm2', pin: 'sel' })
    w({ chip: 'm2', pin: 'out' }, { pin: 'out' })
    return c
  }
  // Same layout as the course's Memory test, different values.
  const SCRIPT = `load Memory.hdl, output-file Memory.out, compare-to Memory.cmp,
    output-list in%D1.6.1 load%B2.1.2 address%B1.15.1 out%D1.6.1 RAM16K[5]%D1.6.1 Screen[5]%D1.6.1;
    echo "Select the Screen view";
    set in 111, set load 1, set address 5, tick, output; tock, output;
    set in 222, set address %X4005, tick, output; tock, output;
    set load 0, set address 5, eval, output;
    set address 24576, echo "Hold K", while out <> 75 { tick, tock, } output;`

  it('gives the same rows as the built-in Memory block', () => {
    const user = run(userMemory(75), SCRIPT)
    const builtin = run(single('Memory', { key: 75 }), SCRIPT)
    expect(user.stopped).toBeUndefined()
    expect(user.rows).toEqual(builtin.rows)
    expect(user.rows).toHaveLength(6)
    expect(cells(user.rows[1])).toEqual(['111', '1', '000000000000101', '111', '111', '0']) // RAM[5] written at the tock
    expect(cells(user.rows[3])).toEqual(['222', '1', '100000000000101', '222', '111', '222']) // Screen[5] written
    expect(cells(user.rows[4])).toEqual(['222', '0', '000000000000101', '111', '111', '222']) // a read: nothing is written
    expect(cells(user.rows[5])).toEqual(['222', '0', '110000000000000', '75', '111', '222'])
  })
  it('without a held key the waiting loop is stopped with the message and the earlier rows are kept', () => {
    const user = run(userMemory(0), SCRIPT)
    expect(user.rows).toHaveLength(5)
    expect(user.stopped).toMatch(/key box of the Keyboard block/)
    expect(user.stopped).toMatch(/Hold K/)
  })
})

describe('9. tick and tock evaluate the circuit once each', () => {
  it('a plain tick, tock cycle evaluates at most twice, and output after it adds nothing', () => {
    const sim = new Simulator(single('Register'))
    const inp = { in: 5, load: 1 }
    sim.eval(inp) // warm: one evaluation
    const before = sim.evalCount
    for (let i = 0; i < 10; i++) {
      sim.tick(inp)
      sim.tock(inp)
      sim.eval(inp) // what an `output` does
    }
    expect(sim.evalCount - before).toBeLessThanOrEqual(10) // 1 per cycle: the tick reuses the evaluation, the tock makes one
  })
  it('changing an input between ticks does evaluate again; the cache never returns stale values', () => {
    const sim = new Simulator(single('Register'))
    sim.tick({ in: 5, load: 1 })
    sim.tock({ in: 5, load: 1 })
    expect(sim.eval({ in: 6, load: 1 }).outputs.out).toBe(5)
    sim.tick({ in: 6, load: 1 })
    expect(sim.eval({ in: 6, load: 1 }).outputs.out).toBe(5) // a tick alone changes no output
    sim.tock({ in: 6, load: 1 })
    expect(sim.eval({ in: 6, load: 1 }).outputs.out).toBe(6)
  })
  it('poke, reset, loadRom and setKeyboard all drop the cached result', () => {
    const sim = new Simulator(single('Computer'))
    const inp = { reset: 0 }
    sim.eval(inp)
    sim.poke('u', 3, 9)
    expect(sim.peek('u', 3)).toBe(9)
    sim.reset()
    expect(sim.peek('u', 3)).toBe(0)
    const n = sim.evalCount
    sim.loadRom([1])
    sim.eval(inp)
    sim.setKeyboard(5)
    sim.eval(inp)
    expect(sim.evalCount - n).toBe(2)
  })
  it('a whole script: 2 evaluations per cycle at most for tick, tock, output', () => {
    const c = single('Register')
    // run() builds its own Simulator, so count through the engine with an equivalent loop
    const sim = new Simulator(c)
    const inp = { in: 1, load: 1 }
    for (let i = 0; i < 100; i++) {
      sim.tick(inp)
      sim.eval(inp) // output after tick
      sim.tock(inp)
      sim.eval(inp) // output after tock
    }
    expect(sim.evalCount).toBeLessThanOrEqual(101)
  })
})
