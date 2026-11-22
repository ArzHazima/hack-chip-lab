// Reads ONLY the interface of a Nand2Tetris .hdl file: the IN / OUT pin names and widths.
// Everything after PARTS: (the implementation) is deliberately ignored.
//
//   CHIP CompactALU {
//     IN x[16], y[16], zx, nx;   // several pins per line, widths in [ ]
//     OUT out[16], zr;
//     PARTS: ...
//   }

import { MAX_WIDTH } from './chips'

export interface PinSpec {
  name: string
  width: number
}

export interface HdlInterface {
  chipName: string
  inputs: PinSpec[]
  outputs: PinSpec[]
}

export class HdlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HdlParseError'
  }
}

/** Throws if a pin is wider than the engine supports (it would silently compute 0). */
function assertPinWidth(name: string, width: number): void {
  if (width > MAX_WIDTH) throw new HdlParseError(`Pin "${name}" is ${width} bits wide; the maximum is ${MAX_WIDTH}`)
}

/** Same check for an interface that was not produced by the parser (e.g. built by hand). */
export function assertInterfaceWidths(iface: HdlInterface): void {
  for (const p of [...iface.inputs, ...iface.outputs]) assertPinWidth(p.name, p.width)
}

function parsePins(body: string, kind: 'IN' | 'OUT'): PinSpec[] {
  if (body.trim() === '') return [] // "IN ;" = no pins
  return body.split(',').map((raw) => {
    const m = raw.trim().match(/^([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?$/)
    if (!m) throw new HdlParseError(`Bad ${kind} pin declaration "${raw.trim()}" (expected name or name[width])`)
    const width = m[2] === undefined ? 1 : Number(m[2])
    if (width < 1) throw new HdlParseError(`Pin "${m[1]}" has width ${width}; widths start at 1`)
    assertPinWidth(m[1], width)
    return { name: m[1], width }
  })
}

export function parseHdlInterface(text: string): HdlInterface {
  // Remove /* ... */ (also /** ... */) and // comments first, so commented-out pins are ignored.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

  const head = clean.match(/\bCHIP\s+([A-Za-z_]\w*)\s*\{/)
  if (!head) throw new HdlParseError('No "CHIP Name {" declaration found')
  // Only look at the part between "{" and PARTS: / BUILTIN / CLOCKED, i.e. the interface.
  let body = clean.slice(head.index! + head[0].length)
  const stop = body.search(/\b(PARTS|BUILTIN|CLOCKED)\b/)
  if (stop >= 0) body = body.slice(0, stop)

  const inputs: PinSpec[] = []
  const outputs: PinSpec[] = []
  let found = false
  for (const m of body.matchAll(/\b(IN|OUT)\b([^;]*);/g)) {
    found = true
    ;(m[1] === 'IN' ? inputs : outputs).push(...parsePins(m[2], m[1] as 'IN' | 'OUT'))
  }
  // Whatever IN/OUT text is left after removing every terminated declaration was missing its ";".
  // Without this check such a declaration would be dropped silently and the chip would lose pins.
  const unterminated = body.replace(/\b(IN|OUT)\b[^;]*;/g, ' ').match(/\b(IN|OUT)\b[\s\S]*/)
  if (unterminated) {
    const near = unterminated[0].replace(/\s+/g, ' ').trim().slice(0, 40)
    throw new HdlParseError(`CHIP ${head[1]}: an ${unterminated[1]} declaration is missing its closing ";" (near "${near}")`)
  }
  if (!found) throw new HdlParseError(`CHIP ${head[1]} has no IN or OUT declaration`)

  const seen = new Set<string>()
  for (const p of [...inputs, ...outputs]) {
    if (seen.has(p.name)) throw new HdlParseError(`Pin "${p.name}" is declared twice`)
    seen.add(p.name)
  }
  return { chipName: head[1], inputs, outputs }
}
