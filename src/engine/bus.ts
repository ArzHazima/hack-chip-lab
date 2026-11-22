// Wiring nodes for buses (the standard Nand2Tetris `a[0..7]` / `out[3]` / `true` features):
//
//   Split  one N-bit input   → outputs that are single bits or ranges of it  (like  in[0..7])
//   Join   inputs that are single bits or ranges → ONE N-bit output          (like  out[0..7]=x)
//   Const  true (all ones) or false (all zeros) of a chosen width
//
// They are not in the CHIPS table because their pins depend on settings (`ChipParams`):
// `busDef` builds an ordinary ChipDef for one instance, so the simulator treats them like any chip.

import { MAX_WIDTH, mask, type ChipDef, type PinDef } from './chips'
import type { ChipParams, Range } from './circuit'

export const BUS_TYPES = ['Split', 'Join', 'Const'] as const
export const isBusType = (type: string): boolean => (BUS_TYPES as readonly string[]).includes(type)

/** Widest bus supported (same limit as every pin; see MAX_WIDTH). */
export const MAX_BUS_WIDTH = MAX_WIDTH

export const rangeWidth = (r: Range): number => r.hi - r.lo + 1
/** Pin name of a range: `[3]` or `[0..7]`. It doubles as the label shown on the board. */
export const rangeName = (r: Range): string => (r.lo === r.hi ? `[${r.lo}]` : `[${r.lo}..${r.hi}]`)

/** Every bit on its own: [0], [1], ... [width-1]. */
export const singleBits = (width: number): Range[] =>
  Array.from({ length: Math.max(0, width) }, (_, i) => ({ lo: i, hi: i }))

/**
 * Parses "0..7, 8..15, 3" (brackets optional) into ranges. Empty text means "every bit on its own".
 * Only the SYNTAX is checked here; whether the ranges fit the bus is checked by `busErrors`.
 */
export function parseRanges(text: string, width: number): { ranges: Range[]; error?: string } {
  const tokens = text.split(/[,\s]+/).filter(Boolean)
  if (tokens.length === 0) return { ranges: singleBits(width) }
  const ranges: Range[] = []
  for (const raw of tokens) {
    const m = raw.replace(/^\[|\]$/g, '').match(/^(\d+)(?:\.\.(\d+))?$/)
    if (!m) return { ranges: [], error: `Bad range "${raw}" (write a bit like 3, or a range like 0..7)` }
    const lo = Number(m[1])
    const hi = m[2] === undefined ? lo : Number(m[2])
    if (lo > hi) return { ranges: [], error: `Range ${lo}..${hi} must go from the low bit to the high bit (${hi}..${lo})` }
    ranges.push({ lo, hi })
  }
  return { ranges }
}

/** The pins and behaviour of one Split / Join / Const instance. Tolerant of bad params (see busErrors). */
export function busDef(type: string, params: ChipParams): ChipDef {
  const width = params.width
  const ranges = params.ranges ?? singleBits(width)
  const pins = (): PinDef[] => ranges.map((r) => ({ name: rangeName(r), width: rangeWidth(r) }))

  if (type === 'Split') {
    return {
      name: 'Split',
      inputs: [{ name: 'in', width }],
      outputs: pins(),
      eval: (inp) =>
        Object.fromEntries(ranges.map((r) => [rangeName(r), mask(inp.in >>> r.lo, rangeWidth(r))])),
    }
  }
  if (type === 'Join') {
    return {
      name: 'Join',
      inputs: pins(),
      outputs: [{ name: 'out', width }],
      eval: (inp) => ({
        out: mask(ranges.reduce((acc, r) => acc | (mask(inp[rangeName(r)], rangeWidth(r)) << r.lo), 0), width),
      }),
    }
  }
  // Const
  return {
    name: 'Const',
    inputs: [],
    outputs: [{ name: 'out', width }],
    eval: () => ({ out: params.ones ? mask(-1, width) : 0 }),
  }
}

/** "bits 4..7" for a sorted list of bit numbers: turns [4,5,6,7,9] into "4..7, 9". */
function describeBits(bits: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < bits.length; ) {
    let j = i
    while (j + 1 < bits.length && bits[j + 1] === bits[j] + 1) j++
    parts.push(i === j ? `${bits[i]}` : `${bits[i]}..${bits[j]}`)
    i = j + 1
  }
  return parts.join(', ')
}

/**
 * Problems with the settings of one wiring node: bad width, a range outside the bus,
 * a range listed twice, (Join only) ranges that overlap, and bits no input drives.
 * Overlap is allowed on a Split (reading a bit twice is harmless) but not on a Join
 * (two inputs would drive the same output bit).
 */
export function busErrors(id: string, type: string, params: ChipParams | undefined): string[] {
  const who = `${type} ${id}`
  if (!params) return [`${who}: missing settings (width)`]
  const { width } = params
  if (!Number.isInteger(width) || width < 1 || width > MAX_BUS_WIDTH) {
    return [`${who}: width must be a whole number from 1 to ${MAX_BUS_WIDTH} (got ${width})`]
  }
  if (type === 'Const') return []

  const errors: string[] = []
  const ranges = params.ranges ?? singleBits(width)
  if (ranges.length === 0) errors.push(`${who}: has no ranges`)
  for (const r of ranges) {
    if (r.lo < 0 || r.hi >= width || r.lo > r.hi) {
      errors.push(`${who}: range ${rangeName(r)} is outside the bus (bits 0..${width - 1})`)
    }
  }
  const seen = new Set<string>()
  for (const r of ranges) {
    const n = rangeName(r)
    if (seen.has(n)) errors.push(`${who}: range ${n} is listed twice`)
    seen.add(n)
  }
  if (errors.length || type !== 'Join') return errors

  // Join: every output bit must be driven by exactly one input range.
  const owner: (Range | undefined)[] = Array(width).fill(undefined)
  const overlapping = new Set<number>()
  for (const r of ranges) {
    for (let b = r.lo; b <= r.hi; b++) {
      if (owner[b]) overlapping.add(b)
      owner[b] = r
    }
  }
  if (overlapping.size) {
    errors.push(`${who}: input ranges overlap, so bits ${describeBits([...overlapping].sort((a, b) => a - b))} would be driven twice`)
  }
  const undriven = owner.flatMap((o, b) => (o ? [] : [b]))
  if (undriven.length) errors.push(`${who}: bits ${describeBits(undriven)} of the ${width}-bit output are not driven by any input range`)
  return errors
}
