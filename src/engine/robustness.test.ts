// Pre-v1.0 engine robustness: hostile or huge .tst scripts must stop quickly with a clear message
// (never hang, never lose the rows already produced). Fixtures are invented.
import { describe, expect, it } from 'vitest'
import { CHIPS } from './chips'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { runExercise } from './exercise'
import { Simulator } from './sequential'
import { parseTst, runTst, TstParseError } from './tst'

/** One chip with every pin wired to a circuit pin of the same name. */
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
const run = (c: Circuit, script: string) => runTst(c, parseTst(script))
const timed = <T>(fn: () => T): { v: T; ms: number } => {
  const t = performance.now()
  const v = fn()
  return { v, ms: performance.now() - t }
}

describe('H1. warnings and info lines are de-duplicated with a Set and capped', () => {
  it('60,000 distinct unknown commands parse in under 1 second, with 50 warnings + one summary line', () => {
    const script = Array.from({ length: 60000 }, (_, i) => `frob${i};`).join('\n')
    const { v: t, ms } = timed(() => parseTst(script))
    // eslint-disable-next-line no-console
    console.log(`MEASURE H1 parse 60,000 unknown commands: ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(1000)
    expect(t.warnings).toHaveLength(51)
    expect(t.warnings[50]).toBe('... and 59950 more')
  })
  it('the same warning text is still reported once', () => {
    const t = parseTst('frob 1; frob 2; frob 3;')
    expect(t.warnings).toEqual(['Unknown command "frob" was ignored'])
  })
  it('60,000 distinct echo lines run in under 1 second, with 50 info lines + one summary line', () => {
    const script = 'output-list out%D1.3.1;\n' + Array.from({ length: 60000 }, (_, i) => `echo "line ${i}";`).join('\n')
    const { v: out, ms } = timed(() => run(single('Register'), script))
    // eslint-disable-next-line no-console
    console.log(`MEASURE H1 run 60,000 distinct echo lines: ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(1000)
    expect(out.info).toHaveLength(51)
    expect(out.info[50]).toBe('... and 59950 more')
  })
  it('run-time warnings (values that do not fit) are capped too', () => {
    const script = 'output-list out%D1.3.1;\n' + Array.from({ length: 5000 }, (_, i) => `set in ${70000 + i};`).join('\n')
    const out = run(single('Register'), script)
    expect(out.warnings).toHaveLength(51)
    expect(out.warnings[50]).toBe('... and 4950 more')
  })
})

describe('H2. output-list sizes and the total output are bounded', () => {
  it('a column whose left + len + right is over 64 is a clear parse error', () => {
    const { ms } = timed(() => {
      expect(() => parseTst('output-list out%S0.400000000.0;')).toThrow(TstParseError)
      expect(() => parseTst('output-list out%S0.400000000.0;')).toThrow(/at most 64/)
      expect(() => parseTst('output-list out%B30.30.30;')).toThrow(/at most 64/)
    })
    expect(ms).toBeLessThan(1000)
    expect(() => parseTst('output-list out%B20.24.20;')).not.toThrow() // exactly 64 is fine
  })
  it('more than 200 columns is a clear parse error (5,000 columns stop quickly)', () => {
    const cols = Array.from({ length: 5000 }, () => 'out%D1.3.1').join(' ')
    const { ms } = timed(() => expect(() => parseTst(`output-list ${cols};`)).toThrow(/at most 200 columns/))
    expect(ms).toBeLessThan(1000)
    const ok = Array.from({ length: 200 }, () => 'out%D1.3.1').join(' ')
    expect(() => parseTst(`output-list ${ok};`)).not.toThrow()
  })
  it('100,000+ rows stop with a message and keep the rows produced so far', () => {
    const { v: out, ms } = timed(() => run(single('Register'), 'output-list out%D1.3.1; repeat 150000 { output; }'))
    expect(ms).toBeLessThan(5000)
    expect(out.rows).toHaveLength(100000)
    expect(out.stopped).toMatch(/too many output rows/)
  })
  it('a huge total output (200 wide columns x many rows) stops at ~50 MB of text with the rows so far', () => {
    const cols = Array.from({ length: 200 }, () => 'out%S0.64.0').join(' ')
    const { v: out, ms } = timed(() => run(single('Register'), `output-list ${cols}; repeat 100000 { output; }`))
    expect(ms).toBeLessThan(10000)
    expect(out.stopped).toMatch(/too much output/)
    expect(out.rows.length).toBeGreaterThan(1000)
    expect(out.rows.length).toBeLessThan(100000)
    expect(out.rows.reduce((n, r) => n + r.length, 0)).toBeLessThanOrEqual(50_000_000)
  })
})

describe('M3. a run-time error in the middle of a script keeps the rows so far', () => {
  const head = 'output-list in%D1.3.1 out%D1.3.1; set load 1, set in 7, tick, tock, output; '
  it('an unknown pin in a later `set` returns the first rows plus a stopped message', () => {
    const out = run(single('Register'), head + 'output; set nope 1; output;')
    expect(out.rows).toHaveLength(2)
    expect(out.stopped).toMatch(/nope/)
  })
  it('Type[99999] out of range', () => {
    const out = run(single('RAM8'), 'output-list out%D1.3.1; output; set RAM8[99999] 1; output;')
    expect(out.rows).toHaveLength(1)
    expect(out.stopped).toMatch(/RAM8\[99999\]/)
  })
  it('an unknown pin in the output-list, found when `output` runs', () => {
    const out = run(single('Register'), 'output-list out%D1.3.1; output; output-list ghost%D1.3.1; output;')
    expect(out.rows).toHaveLength(1)
    expect(out.stopped).toMatch(/ghost/)
  })
  it('a script that is too long (command budget) keeps its rows', () => {
    const out = run(single('Register'), 'output-list out%D1.3.1; output; repeat 2000000 { eval; }')
    expect(out.rows).toHaveLength(1)
    expect(out.stopped).toMatch(/too long/)
  })
  it('runExercise reports the stop in `message` and the run is not ok', () => {
    const cmp = '| out |\n|   0 |\n|   0 |\n'
    const r = runExercise(single('Register'), 'output-list out%D1.3.1; output; output; set nope 1; output;', cmp)
    expect(r.rows).toHaveLength(2)
    expect(r.passed).toBe(2)
    expect(r.message).toMatch(/nope/)
  })
  it('an error before any row was produced is still thrown (nothing to keep; the board shows the error)', () => {
    expect(() => run(single('Register'), 'output-list out%D1.3.1; set nope 1; output;')).toThrow(/nope/)
  })
})

describe('M5. ignored course-header commands are info lines, not warnings', () => {
  const header = 'load Foo.hdl,\noutput-file Foo.out,\ncompare-to Foo.cmp,\n'
  it('parseTst puts them in `notices`, leaving `warnings` empty', () => {
    const t = parseTst(header + 'output-list out%D1.3.1; output;')
    expect(t.warnings).toEqual([])
    expect(t.notices).toHaveLength(3)
    expect(t.notices[0]).toMatch(/"load Foo\.hdl" was ignored/)
  })
  it('runExercise shows them in `info` (grey) and a fully passing script has no warnings', () => {
    const r = runExercise(single('Register'), header + 'echo "hi"; output-list out%D1.3.1; output;', '| out |\n|   0 |\n')
    expect(r.warnings).toEqual([])
    expect(r.passed).toBe(1)
    expect(r.info).toHaveLength(4)
    expect(r.info[0]).toMatch(/was ignored/)
    expect(r.info[3]).toBe('hi')
  })
  it('a real warning (unknown command) stays a warning', () => {
    const t = parseTst(header + 'frob; output-list out%D1.3.1; output;')
    expect(t.warnings).toEqual(['Unknown command "frob" was ignored'])
  })
})

describe('M4. peek at the tick phase (pins the current behaviour, documented in CLAUDE.md)', () => {
  it('a register shows the value latched at the tick; a memory word changes only at the tock', () => {
    const reg = new Simulator(single('Register'))
    const ram = new Simulator(single('RAM8'))
    const rIn = { in: 9, load: 1 }
    const mIn = { in: 9, load: 1, address: 3 }
    expect(reg.peek('u')).toBe(0)
    expect(ram.peek('u', 3)).toBe(0)
    reg.tick(rIn)
    ram.tick(mIn)
    expect(reg.peek('u')).toBe(9) // register: already the NEW value at the tick ("1+")
    expect(reg.eval(rIn).outputs.out).toBe(0) // ...while its output pin is still the old one
    expect(ram.peek('u', 3)).toBe(0) // memory: the write is not visible yet
    reg.tock(rIn)
    ram.tock(mIn)
    expect(reg.peek('u')).toBe(9)
    expect(reg.eval(rIn).outputs.out).toBe(9)
    expect(ram.peek('u', 3)).toBe(9) // memory: visible after the tock
  })
})
