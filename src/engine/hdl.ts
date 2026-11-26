// Reads ONLY the interface of a Nand2Tetris .hdl file: the IN / OUT pin names and widths.
// Everything after PARTS: (the implementation) is deliberately ignored.
//
//   CHIP CompactALU {
//     IN x[16], y[16], zx, nx;   // several pins per line, widths in [ ]
//     OUT out[16], zr;
//     PARTS: ...
//   }

import { MAX_WIDTH } from './chips'
import { stripComments } from './text'

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
  const clean = stripComments(text)

  const head = clean.match(/\bCHIP\s+([A-Za-z_]\w*)\s*\{/)
  if (!head) throw new HdlParseError('No "CHIP Name {" declaration found')
  // Only look at the part between "{" and PARTS: / BUILTIN / CLOCKED, i.e. the interface.
  let body = clean.slice(head.index! + head[0].length)
  const stop = body.search(/\b(PARTS|BUILTIN|CLOCKED)\b/)
  if (stop >= 0) body = body.slice(0, stop)

  const inputs: PinSpec[] = []
  const outputs: PinSpec[] = []
  let found = false
  // Linear scan: find each IN / OUT keyword, then the next ";". (The old regex did [^;]*; after every keyword and
  // backtracked: on "IN IN IN ..." without a ";" every keyword rescanned the whole rest of the text.)
  const keyword = /\b(IN|OUT)\b/g
  for (let m = keyword.exec(body); m; m = keyword.exec(body)) {
    const semi = body.indexOf(';', keyword.lastIndex)
    if (semi < 0) {
      // This declaration has no ";". Without this check it would be dropped silently.
      const near = body.slice(m.index, m.index + 200).replace(/\s+/g, ' ').trim().slice(0, 40)
      throw new HdlParseError(`CHIP ${head[1]}: an ${m[1]} declaration is missing its closing ";" (near "${near}")`)
    }
    found = true
    ;(m[1] === 'IN' ? inputs : outputs).push(...parsePins(body.slice(keyword.lastIndex, semi), m[1] as 'IN' | 'OUT'))
    keyword.lastIndex = semi + 1 // continue after the ";" (words inside the declaration are not keywords)
  }
  if (!found) throw new HdlParseError(`CHIP ${head[1]} has no IN or OUT declaration`)

  const seen = new Set<string>()
  for (const p of [...inputs, ...outputs]) {
    if (seen.has(p.name)) throw new HdlParseError(`Pin "${p.name}" is declared twice`)
    seen.add(p.name)
  }
  return { chipName: head[1], inputs, outputs }
}
