// Bit ranges directly on pins ("range handles"), as an alternative to Split / Join nodes.
//
// A multi-bit pin can own extra handles such as `a[4..7]`. A wire from / to such a handle carries only
// those bits. Instead of teaching the simulation engine a new concept, `compileRanges` rewrites the
// graph into the equivalent graph with ordinary Split / Join nodes, which the engine already
// understands:
//
//   reading a pin through ranges  ->  pin --> Split --[lo..hi]--> wire
//   driving a pin through ranges  ->  wire --[lo..hi]--> Join --> pin
//
// Pure TypeScript (no React). Everything here is unit-tested, including "golden" tests that compare
// a circuit built with ranges with the same circuit built with Split / Join nodes.

import type { Edge } from '@xyflow/react'
import { rangeName } from '../engine/bus'
import { defOfData } from './busParams'
import type { AppNode, PinIssue, PinRange } from './types'

/** Bits lo..hi of a bus (both included, bit 0 = least significant). */
export interface BitRange {
  lo: number
  hi: number
}

export const rangeWidth = (r: BitRange): number => r.hi - r.lo + 1

/** The handle id of a range handle: `a[4..7]` or `out[3]` (the pin's handle id plus the range). */
export const rangeHandleId = (r: PinRange): string => `${r.pin}${rangeName(r)}`

/** The two ends of a drag over the bit strip, in either order. */
export const normalizeRange = (a: number, b: number): BitRange => ({ lo: Math.min(a, b), hi: Math.max(a, b) })

export type Preset = 'bits' | 'nibbles' | 'bytes'

/** Ranges that cut a pin into single bits, nibbles (4 bits) or bytes (8 bits); the last piece may be shorter. */
export function presetRanges(width: number, preset: Preset): BitRange[] {
  const size = preset === 'bits' ? 1 : preset === 'nibbles' ? 4 : 8
  const out: BitRange[] = []
  for (let lo = 0; lo < width; lo += size) out.push({ lo, hi: Math.min(lo + size, width) - 1 })
  return out
}

/** Adds ranges to one pin: skips duplicates and ranges that do not fit in `width`. Never modifies `existing`. */
export function addRanges(existing: PinRange[], pin: string, wanted: BitRange[], width: number): PinRange[] {
  const next = [...existing]
  for (const w of wanted) {
    if (w.lo < 0 || w.hi < w.lo || w.hi >= width) continue
    if (next.some((r) => r.pin === pin && r.lo === w.lo && r.hi === w.hi)) continue
    next.push({ pin, lo: w.lo, hi: w.hi })
  }
  return next
}

export const removeRange = (existing: PinRange[], gone: PinRange): PinRange[] =>
  existing.filter((r) => !(r.pin === gone.pin && r.lo === gone.lo && r.hi === gone.hi))

// ---------------------------------------------------------------------------

export interface RangeIssue extends PinIssue {
  nodeId: string
}

export interface CompiledRanges {
  nodes: AppNode[]
  edges: Edge[]
  errors: string[] // one clear message per problem (also shown in the Run error)
  issues: RangeIssue[] // the same problems, attached to the pins they are about
}

/** One end of a wire, resolved against its node. */
interface End {
  node: AppNode
  pin: string // the pin's own handle id ('a', 'out', 'in' ...)
  width: number // width of the whole pin
  range?: PinRange // set when the handle is a range handle
  label: string // for messages: `x`, `x[4..7]`, `Mux161.a[4..7]`
  pinLabel: string // same without the range
}

const plural = (n: number) => `${n} bit${n === 1 ? '' : 's'}`

/** "4..7, 12" for a sorted list of bit numbers. */
function bitList(bits: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < bits.length; ) {
    let j = i
    while (j + 1 < bits.length && bits[j + 1] === bits[j] + 1) j++
    parts.push(i === j ? `${bits[i]}` : `${bits[i]}..${bits[j]}`)
    i = j + 1
  }
  return parts.join(', ')
}

const rangesText = (rs: BitRange[]): string => rs.map((r) => (r.lo === r.hi ? `${r.lo}` : `${r.lo}..${r.hi}`)).join(', ')

function endOf(node: AppNode | undefined, handle: string | null | undefined): End | undefined {
  if (!node || !handle) return undefined
  const declared = (node.data as { ranges?: PinRange[] }).ranges ?? []
  const range = declared.find((r) => rangeHandleId(r) === handle)
  const pin = range ? range.pin : handle
  let width: number | undefined
  let pinLabel: string
  if (node.type === 'chip') {
    const def = defOfData(node.data)
    width = (def?.outputs.find((p) => p.name === pin) ?? def?.inputs.find((p) => p.name === pin))?.width
    pinLabel = `${node.id}.${pin}`
  } else {
    width = node.data.width
    pinLabel = node.data.name
  }
  if (width === undefined) return undefined
  return { node, pin, width, range, pinLabel, label: range ? `${pinLabel}${rangeName(range)}` : pinLabel }
}

/**
 * Rewrites a graph that uses range handles into the equivalent graph with ordinary Split / Join nodes.
 *  - a graph without range wires is returned unchanged (so circuits saved before ranges load as before);
 *  - the wires that went through range handles keep their ids, so the board still colours them and
 *    labels them with the value of THEIR bits;
 *  - on any problem `errors` / `issues` explain it and the wires through range handles are dropped
 *    (no half-compiled graph).
 */
export function compileRanges(nodes: AppNode[], edges: Edge[]): CompiledRanges {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const errors: string[] = []
  const issues: RangeIssue[] = []
  const fail = (message: string, ...where: { nodeId: string; pin: string }[]) => {
    errors.push(message)
    for (const w of where) issues.push({ ...w, message })
  }
  const where = (e: End) => ({ nodeId: e.node.id, pin: e.pin })

  // 1. Which wires touch a range handle?
  type Ranged = { e: Edge; s: End; t: End }
  const plain: Edge[] = []
  const ranged: Ranged[] = []
  for (const e of edges) {
    const s = endOf(byId.get(e.source), e.sourceHandle)
    const t = endOf(byId.get(e.target), e.targetHandle)
    if (s && t && (s.range || t.range)) ranged.push({ e, s, t })
    else plain.push(e)
  }
  if (ranged.length === 0) return { nodes, edges, errors, issues }

  // 2. Per wire: the range must fit its pin, and both sides must have the same width.
  for (const { s, t } of ranged) {
    let fits = true
    for (const end of [s, t]) {
      if (end.range && (end.range.lo < 0 || end.range.hi < end.range.lo || end.range.hi >= end.width)) {
        fits = false
        fail(`${end.label}: the range is outside the pin (${plural(end.width)} wide)`, where(end))
      }
    }
    if (!fits) continue
    const sw = s.range ? rangeWidth(s.range) : s.width
    const tw = t.range ? rangeWidth(t.range) : t.width
    if (sw !== tw) {
      fail(`Width mismatch on wire ${s.label} (${plural(sw)}) → ${t.label} (${plural(tw)}): both sides must have the same width`, where(s), where(t))
    }
  }

  // 3. Pins DRIVEN through ranges: every bit exactly once, and not also as a whole.
  const targetKey = (e: End) => `${e.node.id}\u0000${e.pin}`
  const targets = new Map<string, { end: End; drivers: BitRange[]; whole: number }>()
  const wholeDrivers = new Map<string, number>() // wires that drive a whole pin
  const noteWhole = (t: End | undefined) => t && !t.range && wholeDrivers.set(targetKey(t), (wholeDrivers.get(targetKey(t)) ?? 0) + 1)
  for (const e of plain) noteWhole(endOf(byId.get(e.target), e.targetHandle))
  for (const { t } of ranged) {
    if (t.range) {
      const g = targets.get(targetKey(t)) ?? { end: t, drivers: [], whole: 0 }
      g.drivers.push({ lo: t.range.lo, hi: t.range.hi })
      targets.set(targetKey(t), g)
    } else noteWhole(t)
  }
  for (const [key, g] of targets) {
    const t = g.end
    if (wholeDrivers.get(key)) {
      fail(`${t.pinLabel}: this pin is driven both as a whole and through bit ranges; use only one of them`, where(t))
      continue
    }
    const count = Array.from({ length: t.width }, () => 0)
    for (const d of g.drivers) for (let b = Math.max(0, d.lo); b <= Math.min(d.hi, t.width - 1); b++) count[b]++
    const over = count.flatMap((c, b) => (c > 1 ? [b] : []))
    const gaps = count.flatMap((c, b) => (c === 0 ? [b] : []))
    if (over.length) {
      fail(`${t.pinLabel}: the ranges ${g.drivers.map((d) => rangeName(d)).join(', ')} overlap, so bits ${bitList(over)} would be driven twice`, where(t))
    }
    if (gaps.length) fail(`${t.pinLabel}: bits ${bitList(gaps)} are not driven by any wire`, where(t))
  }

  // On any problem: keep only the ordinary wires. Nothing half-compiled reaches the simulator.
  if (errors.length) return { nodes, edges: plain, errors, issues }

  // 4. Build the Split / Join nodes and the rewritten wires.
  const synthetic: AppNode[] = []
  const infra: Edge[] = []
  const rewritten: Edge[] = []

  const splitOf = new Map<string, { id: string; ranges: BitRange[] }>() // pins READ through ranges
  for (const { s } of ranged) {
    if (!s.range) continue
    const key = targetKey(s)
    const g = splitOf.get(key) ?? { id: `rs:${s.node.id}:${s.pin}`, ranges: [] }
    if (!g.ranges.some((r) => r.lo === s.range!.lo && r.hi === s.range!.hi)) g.ranges.push({ lo: s.range.lo, hi: s.range.hi })
    splitOf.set(key, g)
  }
  for (const { s } of ranged) {
    const g = s.range && splitOf.get(targetKey(s))
    if (!g || synthetic.some((n) => n.id === g.id)) continue
    synthetic.push({
      id: g.id, type: 'chip', position: { x: 0, y: 0 },
      data: { type: 'Split', params: { width: s.width, ranges: rangesText(g.ranges) } },
    } as AppNode)
    infra.push({ id: `${g.id}:in`, source: s.node.id, sourceHandle: s.pin, target: g.id, targetHandle: 'in' })
  }

  const joinOf = new Map<string, string>() // pins DRIVEN through ranges
  for (const [key, g] of targets) {
    const id = `rj:${g.end.node.id}:${g.end.pin}`
    joinOf.set(key, id)
    synthetic.push({
      id, type: 'chip', position: { x: 0, y: 0 },
      data: { type: 'Join', params: { width: g.end.width, ranges: rangesText(g.drivers) } },
    } as AppNode)
    infra.push({ id: `${id}:out`, source: id, sourceHandle: 'out', target: g.end.node.id, targetHandle: g.end.pin })
  }

  for (const { e, s, t } of ranged) {
    const split = s.range && splitOf.get(targetKey(s))
    const join = t.range && joinOf.get(targetKey(t))
    rewritten.push({
      ...e,
      source: split ? split.id : e.source,
      sourceHandle: split ? rangeName(s.range!) : e.sourceHandle,
      target: join ? join : e.target,
      targetHandle: join ? rangeName(t.range!) : e.targetHandle,
    })
  }

  return { nodes: [...nodes, ...synthetic], edges: [...plain, ...rewritten, ...infra], errors, issues }
}
