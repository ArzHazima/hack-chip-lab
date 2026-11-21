import { describe, expect, it } from 'vitest'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from './circuit'
import { cmpTextTable } from './cmp'
import { groupExerciseFiles, runExercise } from './exercise'
import { parseHdlInterface } from './hdl'
import { CircuitError } from './simulate'
import { TstParseError } from './tst'

describe('groupExerciseFiles', () => {
  const f = (name: string) => ({ name, text: `text of ${name}` })

  it('groups the three files of a chip by base name and sorts chips', () => {
    const chips = groupExerciseFiles([
      f('LowestOne16.cmp'), f('CompactALU.hdl'), f('CompactALU.tst'), f('CompactALU.cmp'),
      f('LowestOne16.hdl'), f('LowestOne16.tst'),
    ])
    expect(chips.map((c) => c.name)).toEqual(['CompactALU', 'LowestOne16'])
    expect(chips[0].missing).toEqual([])
    expect(chips[0].cmp?.name).toBe('CompactALU.cmp')
    expect(chips[1].tst?.text).toBe('text of LowestOne16.tst')
  })

  it('lists a chip with a missing file and says which one', () => {
    const [a, b, c] = groupExerciseFiles([f('A.hdl'), f('A.tst'), f('B.cmp'), f('C.hdl'), f('C.cmp')])
    expect(a.missing).toEqual(['cmp'])
    expect(b.missing).toEqual(['hdl', 'tst'])
    expect(c.missing).toEqual(['tst'])
  })

  it('handles folder paths, upper-case extensions and ignores other files', () => {
    const chips = groupExerciseFiles([
      f('ex/sub/Foo.HDL'), f('ex\\sub\\Foo.Tst'), f('ex/Foo.out'), f('ex/readme.txt'), f('.DS_Store'), f('noext'),
    ])
    expect(chips).toHaveLength(1)
    expect(chips[0].name).toBe('Foo')
    expect(chips[0].hdl?.name).toBe('Foo.HDL')
    expect(chips[0].missing).toEqual(['cmp'])
  })

  it('the first file wins when a name appears twice; base names are case-sensitive', () => {
    const chips = groupExerciseFiles([{ name: 'a/X.cmp', text: '1' }, { name: 'b/X.cmp', text: '2' }, f('x.hdl')])
    expect(chips.map((c) => c.name)).toEqual(['X', 'x'])
    expect(chips.find((c) => c.name === 'X')?.cmp?.text).toBe('1')
  })

  it('returns an empty list for no usable files', () => {
    expect(groupExerciseFiles([])).toEqual([])
    expect(groupExerciseFiles([f('notes.md')])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// End to end with a chip of our own (the project's ./examples folder was not available):
// SelectOr16(a, b, sel) = sel ? (a | b) : (a & b)

const HDL = `
// SelectOr16.hdl
CHIP SelectOr16 {
  IN a[16], b[16], sel;
  OUT out[16];
  PARTS:
    And16(a=a, b=b, out=both);
    Or16(a=a, b=b, out=either);
    Mux16(a=both, b=either, sel=sel, out=out);
}`

const TST = `
// SelectOr16.tst
load SelectOr16.hdl,
output-file SelectOr16.out,
compare-to SelectOr16.cmp,
output-list a%B1.16.1 b%B1.16.1 sel%B2.1.2 out%B1.16.1 out%D1.6.1 out%X1.4.1;

set a %B0000000011110000, set b %B0000111100001111, set sel 0, eval, output;
set sel 1, eval, output;
/* all ones */
set a -1, set b %XFF00, set sel 0, eval, output;
set sel 1, eval, output;
`

const CMP = `
|        a         |        b         |sel |       out        | out  | out |
| 0000000011110000 | 0000111100001111 |  0 | 0000000000000000 |    0 | 0000 |
| 0000000011110000 | 0000111100001111 |  1 | 0000111111111111 | 4095 | 0FFF |
| 1111111111111111 | 1111111100000000 |  0 | 1111111100000000 |  -256 | FF00 |
| 1111111111111111 | 1111111100000000 |  1 | 1111111111111111 |   -1 | FFFF |
`

/** The user's circuit: pins come from the HDL interface, wiring is done by hand. */
function selectOr16(): Circuit {
  const iface = parseHdlInterface(HDL)
  let c = emptyCircuit()
  for (const p of iface.inputs) c = addPin(c, p.name, p.name, 'input', p.width)
  for (const p of iface.outputs) c = addPin(c, p.name, p.name, 'output', p.width)
  c = addChip(c, 'and', 'And16')
  c = addChip(c, 'or', 'Or16')
  c = addChip(c, 'mux', 'Mux16')
  c = connect(c, { pin: 'a' }, { chip: 'and', pin: 'a' })
  c = connect(c, { pin: 'b' }, { chip: 'and', pin: 'b' })
  c = connect(c, { pin: 'a' }, { chip: 'or', pin: 'a' })
  c = connect(c, { pin: 'b' }, { chip: 'or', pin: 'b' })
  c = connect(c, { chip: 'and', pin: 'out' }, { chip: 'mux', pin: 'a' })
  c = connect(c, { chip: 'or', pin: 'out' }, { chip: 'mux', pin: 'b' })
  c = connect(c, { pin: 'sel' }, { chip: 'mux', pin: 'sel' })
  return connect(c, { chip: 'mux', pin: 'out' }, { pin: 'out' })
}

describe('end to end: one exercise chip', () => {
  it('the HDL interface creates the right pins', () => {
    const iface = parseHdlInterface(HDL)
    expect(iface.inputs).toEqual([{ name: 'a', width: 16 }, { name: 'b', width: 16 }, { name: 'sel', width: 1 }])
    expect(iface.outputs).toEqual([{ name: 'out', width: 16 }])
  })

  it('.tst (%B %D %X, comments, ignored load/compare-to) + .cmp: every row passes', () => {
    const run = runExercise(selectOr16(), TST, CMP)
    expect(run.warnings).toEqual([])
    expect(run.columns).toEqual(['a', 'b', 'sel', 'out', 'out', 'out'])
    expect(run.rows.filter((r) => !r.pass)).toEqual([])
    expect(run.passed).toBe(4)
    expect(run.total).toBe(4)
    // clicking a row colours wires: row 2 has sel = 1 and out = 0x0FFF
    expect(run.rows[1].snapshot?.inputs.sel).toBe(1)
    expect(run.rows[1].snapshot?.outputs.out).toBe(0x0fff)
  })

  it('a wrong circuit fails the rows it gets wrong', () => {
    const wrong = selectOr16()
    // swap which gate feeds which Mux input: now sel = 0 gives a|b and sel = 1 gives a&b
    wrong.wires = wrong.wires.map((w) =>
      'chip' in w.to && w.to.chip === 'mux' && w.to.pin === 'a' ? { ...w, from: { chip: 'or', pin: 'out' } }
      : 'chip' in w.to && w.to.chip === 'mux' && w.to.pin === 'b' ? { ...w, from: { chip: 'and', pin: 'out' } }
      : w)
    const run = runExercise(wrong, TST, CMP)
    expect(run.passed).toBe(0)
    expect(run.rows[0].expected).not.toBe(run.rows[0].actual)
  })

  it('reports script / circuit problems as errors, unknown commands as warnings', () => {
    expect(() => runExercise(selectOr16(), 'set a 1; eval; output;', CMP)).toThrow(TstParseError) // no output-list
    expect(() => runExercise(selectOr16(), 'output-list zzz%B1.1.1; output;', CMP)).toThrow(CircuitError)
    const warn = runExercise(selectOr16(), 'output-list sel%B1.1.1; frob; set sel 1; output;', '|sel|\n| 1 |')
    expect(warn.warnings).toEqual(['Unknown command "frob" was ignored'])
    expect(warn.passed).toBe(1)
  })

  it('a row-count mismatch is reported', () => {
    const run = runExercise(selectOr16(), 'output-list sel%B1.1.1; output;', '|sel|\n| 0 |\n| 1 |')
    expect(run.message).toMatch(/1 rows, .cmp has 2/)
    expect(run.rows[1].snapshot).toBeUndefined()
  })

  it('compares hex case-insensitively but shows the text as written', () => {
    const run = runExercise(selectOr16(), 'output-list out%X1.4.1; set a 255, set b 255, eval, output;', '|out|\n| 00ff |')
    expect(run.rows[0].pass).toBe(true)
    expect(run.rows[0].actual).toBe('00FF') // our output keeps the %X upper case
    expect(run.rows[0].expected).toBe('00ff')
  })

  it('cmpTextTable shows any .cmp, including sequential ones', () => {
    const t = cmpTextTable('|time | in |\n| 0+  |  1 |\n| 1   |  0 |')
    expect(t.columns).toEqual(['time', 'in'])
    expect(t.rows).toEqual([['0+', '1'], ['1', '0']])
  })
})
