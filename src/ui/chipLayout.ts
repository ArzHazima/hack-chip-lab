// Geometry for chip symbols: which shape a chip uses, its size, and where each
// pin handle sits. Pure TypeScript (no React) so it is easy to reason about.
// All coordinates are pixels inside the chip's own SVG box (origin top-left).

import { defOfData, busTitle } from './busParams'
import type { BusParams } from './types'

export type Shape = 'and' | 'nand' | 'or' | 'xor' | 'not' | 'mux' | 'dmux' | 'box'

export interface PinPlace {
  name: string
  width: number
  io: 'in' | 'out'
  side: 'left' | 'right' | 'bottom'
  x: number // handle position (on the edge of the box)
  y: number
  // Where the short "lead" line joining handle and symbol ends:
  leadX: number
  leadY: number
}

export interface ChipLayout {
  shape: Shape
  w: number
  h: number
  lines: string[] // small text drawn in the middle of the symbol (e.g. "16")
  title?: string // text for a rounded rectangle, when it is not the chip's type name (wiring nodes)
  pins: PinPlace[]
}

export const LEAD = 14 // width of the lead lines on the left/right
const GATE_W = 90
const GATE_H = 56
const MUX_W = 70

/** Which symbol a chip type uses. The 16-bit variants reuse the 1-bit symbol. */
const SHAPE_OF: Record<string, Shape> = {
  Nand: 'nand', Not: 'not', Not16: 'not',
  And: 'and', And16: 'and',
  Or: 'or', Or16: 'or', Xor: 'xor',
  Mux: 'mux', Mux16: 'mux', Mux4Way16: 'mux', Mux8Way16: 'mux',
  DMux: 'dmux', DMux4Way: 'dmux', DMux8Way: 'dmux',
}

const LABEL_OF: Record<string, string[]> = {
  Not16: ['16'], And16: ['16'], Or16: ['16'], Mux16: ['16'],
  Mux4Way16: ['4-way', '16'], Mux8Way16: ['8-way', '16'],
  DMux4Way: ['4-way'], DMux8Way: ['8-way'],
}

export function chipLayout(type: string, params?: BusParams): ChipLayout {
  // Ordinary chips come from the CHIPS table; Split / Join / Const are built from `params`.
  const data = { type, params }
  const def = defOfData(data)!
  const shape = SHAPE_OF[type] ?? 'box'
  const ins = def.inputs
  const outs = def.outputs
  const pins: PinPlace[] = []

  if (shape === 'box') {
    // Rounded rectangle: inputs on the left, outputs on the right, name in the middle.
    const w = 130
    const rows = Math.max(ins.length, outs.length)
    const h = rows * 22 + 34
    ins.forEach((p, i) => {
      const y = 34 + i * 22 - 5
      pins.push({ name: p.name, width: p.width, io: 'in', side: 'left', x: 0, y, leadX: LEAD, leadY: y })
    })
    outs.forEach((p, i) => {
      const y = 34 + i * 22 - 5
      pins.push({ name: p.name, width: p.width, io: 'out', side: 'right', x: w, y, leadX: w - LEAD, leadY: y })
    })
    return { shape, w, h, lines: [], pins, title: busTitle(data) }
  }

  if (shape === 'mux' || shape === 'dmux') {
    // Mux = trapezoid, wide on the left. DMux = mirrored: wide on the right.
    // `data` = the pins on the wide side; the single pin on the narrow side is centred.
    const data = shape === 'mux' ? ins.filter((p) => p.name !== 'sel') : outs
    const h = data.length <= 2 ? 80 : data.length <= 4 ? 140 : 240
    const w = MUX_W
    const spread = (i: number) => ((i + 0.5) / data.length) * h
    if (shape === 'mux') {
      data.forEach((p, i) =>
        pins.push({ name: p.name, width: p.width, io: 'in', side: 'left', x: 0, y: spread(i), leadX: LEAD, leadY: spread(i) }),
      )
      const o = outs[0]
      pins.push({ name: o.name, width: o.width, io: 'out', side: 'right', x: w, y: h / 2, leadX: w - LEAD, leadY: h / 2 })
    } else {
      const i0 = ins.find((p) => p.name !== 'sel')!
      pins.push({ name: i0.name, width: i0.width, io: 'in', side: 'left', x: 0, y: h / 2, leadX: LEAD, leadY: h / 2 })
      data.forEach((p, i) =>
        pins.push({ name: p.name, width: p.width, io: 'out', side: 'right', x: w, y: spread(i), leadX: w - LEAD, leadY: spread(i) }),
      )
    }
    // sel enters from the bottom, in the middle. The slanted bottom edge is at 0.9h there.
    const sel = ins.find((p) => p.name === 'sel')!
    pins.push({ name: 'sel', width: sel.width, io: 'in', side: 'bottom', x: w / 2, y: h, leadX: w / 2, leadY: h * 0.9 })
    return { shape, w, h, lines: LABEL_OF[type] ?? [], pins }
  }

  // Simple gates: And / Nand / Or / Xor / Not. Inputs left, one output right.
  const w = GATE_W
  const h = GATE_H
  // The Or/Xor back curve is concave, so the input leads must reach into it.
  const inLead = shape === 'or' || shape === 'xor' ? 19 : LEAD
  const ys = ins.length === 1 ? [h / 2] : [h * 0.3, h * 0.7]
  ins.forEach((p, i) =>
    pins.push({ name: p.name, width: p.width, io: 'in', side: 'left', x: 0, y: ys[i], leadX: inLead, leadY: ys[i] }),
  )
  const o = outs[0]
  pins.push({ name: o.name, width: o.width, io: 'out', side: 'right', x: w, y: h / 2, leadX: w - LEAD, leadY: h / 2 })
  return { shape, w, h, lines: LABEL_OF[type] ?? [], pins }
}
