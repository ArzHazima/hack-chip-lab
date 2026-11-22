import { describe, expect, it } from 'vitest'
import { HdlParseError, parseHdlInterface } from './hdl'

describe('parseHdlInterface', () => {
  it('reads names and widths, several pins per line', () => {
    const i = parseHdlInterface(`
      CHIP CompactALU {
        IN x[16], y[16], zx, nx, zy;
        OUT out[16], zr, ng;
        PARTS:
          Not16(in=x, out=nx16);
      }`)
    expect(i.chipName).toBe('CompactALU')
    expect(i.inputs).toEqual([
      { name: 'x', width: 16 },
      { name: 'y', width: 16 },
      { name: 'zx', width: 1 },
      { name: 'nx', width: 1 },
      { name: 'zy', width: 1 },
    ])
    expect(i.outputs).toEqual([
      { name: 'out', width: 16 },
      { name: 'zr', width: 1 },
      { name: 'ng', width: 1 },
    ])
  })

  it('handles comments (line, block, doc), odd spacing and pins split over lines', () => {
    const i = parseHdlInterface(`
      // File: Foo.hdl
      /** Doc comment: IN fake[8]; */
      CHIP Foo{ /* inline */
        IN  a [ 16 ] ,   // first
            b[3],
            sel ;
        /* OUT hidden; */
        OUT out
          ;
        PARTS: Mux16(a=a, b=a, sel=sel, out=out);
      }`)
    expect(i.inputs).toEqual([
      { name: 'a', width: 16 },
      { name: 'b', width: 3 },
      { name: 'sel', width: 1 },
    ])
    expect(i.outputs).toEqual([{ name: 'out', width: 1 }])
  })

  it('merges several IN / OUT statements and allows a pin called "in"', () => {
    const i = parseHdlInterface('CHIP X { IN in[16]; IN load; OUT out[16]; OUT done; PARTS: }')
    expect(i.inputs.map((p) => p.name)).toEqual(['in', 'load'])
    expect(i.outputs.map((p) => p.name)).toEqual(['out', 'done'])
  })

  it('ignores PARTS completely, even text that looks like a declaration', () => {
    const i = parseHdlInterface('CHIP X { IN a; OUT o; PARTS: Foo(IN=a, OUT=o); }')
    expect(i.inputs).toEqual([{ name: 'a', width: 1 }])
    expect(i.outputs).toEqual([{ name: 'o', width: 1 }])
  })

  it('a chip name starting with IN or OUT is not mistaken for a declaration', () => {
    const i = parseHdlInterface('CHIP INC16 { IN in[16]; OUT out[16]; PARTS: }')
    expect(i.chipName).toBe('INC16')
    expect(i.inputs).toHaveLength(1)
  })

  it('full IN/OUT syntax for any chip: mixed widths, 3-bit selectors, many pins, CRLF line endings', () => {
    const names = Array.from({ length: 25 }, (_, i) => `p${i}`)
    const i = parseHdlInterface(
      [
        'CHIP Big {',
        '    IN a[16], sel[3], zx, nx,',
        `       ${names.map((n) => `${n}[8]`).join(', ')};`,
        '    OUT out[16], zr, ng,   // flags',
        '        lowest_bit[1];',
        '    PARTS:',
        '}',
      ].join('\r\n'),
    )
    expect(i.inputs).toHaveLength(4 + 25)
    expect(i.inputs.slice(0, 4)).toEqual([
      { name: 'a', width: 16 }, { name: 'sel', width: 3 }, { name: 'zx', width: 1 }, { name: 'nx', width: 1 },
    ])
    expect(i.inputs[28]).toEqual({ name: 'p24', width: 8 })
    expect(i.outputs).toEqual([
      { name: 'out', width: 16 }, { name: 'zr', width: 1 }, { name: 'ng', width: 1 }, { name: 'lowest_bit', width: 1 },
    ])
  })

  it('handles a chip with no inputs, pin names with digits/underscores, and BUILTIN / CLOCKED sections', () => {
    expect(parseHdlInterface('CHIP Const0 { IN ; OUT out; PARTS: }').inputs).toEqual([])
    const i = parseHdlInterface('CHIP D_1 { IN in_1[16], x2; OUT out; BUILTIN D_1; CLOCKED in_1; }')
    expect(i.inputs.map((p) => p.name)).toEqual(['in_1', 'x2'])
    expect(i.outputs).toHaveLength(1)
  })

  it('accepts a 16-bit pin but rejects anything wider with a clear message', () => {
    expect(parseHdlInterface('CHIP X { IN a[16]; OUT o[16]; }').inputs).toEqual([{ name: 'a', width: 16 }])
    // values are masked with 32-bit operators, so wider pins would silently turn into 0
    expect(() => parseHdlInterface('CHIP X { IN a[17]; OUT o; }')).toThrow(/Pin "a" is 17 bits wide; the maximum is 16/)
    expect(() => parseHdlInterface('CHIP X { IN a; OUT wide[32]; }')).toThrow(/Pin "wide" is 32 bits wide; the maximum is 16/)
  })

  it('an IN / OUT declaration without its closing ";" is an error, never silently dropped', () => {
    // the last declaration before PARTS: used to be ignored, leaving the chip with NO outputs
    expect(() => parseHdlInterface('CHIP X { IN a; OUT out PARTS: }')).toThrow(/missing its closing ";".*OUT out/)
    // ... and so was one right before the closing brace (no PARTS section)
    expect(() => parseHdlInterface('CHIP X { IN a; OUT o }')).toThrow(/missing its closing ";"/)
    // pins spread over several lines, no ";" at the end
    expect(() => parseHdlInterface('CHIP X {\n  OUT o;\n  IN a[16],\n     b[16]\n  PARTS:\n}')).toThrow(/missing its closing ";".*IN a\[16\]/)
    // only declaration, unterminated: the error is about the ";", not "no IN or OUT"
    expect(() => parseHdlInterface('CHIP X { IN a }')).toThrow(/missing its closing ";"/)
    // a missing ";" between two declarations is also reported
    expect(() => parseHdlInterface('CHIP X { IN a OUT o; }')).toThrow(HdlParseError)
  })

  it('correctly terminated declarations (including empty ones and a trailing "}") still parse', () => {
    expect(parseHdlInterface('CHIP X { IN a; OUT o; }').outputs).toHaveLength(1)
    expect(parseHdlInterface('CHIP X { IN ; OUT o; }').inputs).toEqual([])
    expect(parseHdlInterface('CHIP X {\n IN a,\n b;\n OUT o;\n PARTS:\n}').inputs).toHaveLength(2)
  })

  it('reports clear errors', () => {
    expect(() => parseHdlInterface('IN a; OUT b;')).toThrow(HdlParseError)
    expect(() => parseHdlInterface('IN a; OUT b;')).toThrow(/CHIP/)
    expect(() => parseHdlInterface('CHIP X { PARTS: }')).toThrow(/no IN or OUT/)
    expect(() => parseHdlInterface('CHIP X { IN a[x]; OUT o; }')).toThrow(/Bad IN pin/)
    expect(() => parseHdlInterface('CHIP X { IN a[0]; OUT o; }')).toThrow(/width 0/)
    expect(() => parseHdlInterface('CHIP X { IN a; OUT a; }')).toThrow(/declared twice/)
  })
})
