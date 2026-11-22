// Bridges the board's node data (text typed by the user) and the engine's ChipParams
// for the wiring nodes Split / Join / Const.

import { isBusType, parseRanges, singleBits } from '../engine/bus'
import type { ChipDef } from '../engine/chips'
import type { ChipParams } from '../engine/circuit'
import { chipOf } from '../engine/resolve'
import type { ChipData } from './types'

/**
 * Engine params for a node, plus a syntax error in the ranges text if there is one.
 * Ordinary chips have no params. `params` is always usable for drawing, even on error.
 */
export function paramsOf(data: ChipData): { params?: ChipParams; error?: string } {
  if (!isBusType(data.type)) return {}
  const width = data.params?.width ?? 1
  if (data.type === 'Const') return { params: { width, ones: !!data.params?.ones } }
  const parsed = parseRanges(data.params?.ranges ?? '', width)
  return parsed.error
    ? { params: { width, ranges: singleBits(width) }, error: parsed.error }
    : { params: { width, ranges: parsed.ranges } }
}

/** The pins of a node (ordinary chip or wiring node), or undefined for an unknown chip type. */
export function defOfData(data: ChipData): ChipDef | undefined {
  return chipOf({ id: '', type: data.type, params: paramsOf(data).params })
}

/** Text shown in the middle of a wiring node, e.g. "Split 16" or "true 8". */
export function busTitle(data: ChipData): string | undefined {
  if (!isBusType(data.type)) return undefined
  const width = data.params?.width ?? 1
  return data.type === 'Const' ? `${data.params?.ones ? 'true' : 'false'} ${width}` : `${data.type} ${width}`
}
