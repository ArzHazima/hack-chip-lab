// Reads ONLY the interface of a Nand2Tetris .hdl file: the IN / OUT pin names and widths.
// Everything after PARTS: (the implementation) is deliberately ignored.
//
//   CHIP CompactALU {
//     IN x[16], y[16], zx, nx;   // several pins per line, widths in [ ]
//     OUT out[16], zr;
//     PARTS: ...
//   }

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

function parsePins(body: string, kind: 'IN' | 'OUT'): PinSpec[] {
  if (body.trim() === '') return [] // "IN ;" = no pins
  return body.split(',').map((raw) => {
    const m = raw.trim().match(/^([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?$/)
    if (!m) throw new HdlParseError(`Bad ${kind} pin declaration "${raw.trim()}" (expected name or name[width])`)
    const width = m[2] === undefined ? 1 : Number(m[2])
    if (width < 1) throw new HdlParseError(`Pin "${m[1]}" has width ${width}; widths start at 1`)
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
  if (!found) throw new HdlParseError(`CHIP ${head[1]} has no IN or OUT declaration`)

  const seen = new Set<string>()
  for (const p of [...inputs, ...outputs]) {
    if (seen.has(p.name)) throw new HdlParseError(`Pin "${p.name}" is declared twice`)
    seen.add(p.name)
  }
  return { chipName: head[1], inputs, outputs }
}
