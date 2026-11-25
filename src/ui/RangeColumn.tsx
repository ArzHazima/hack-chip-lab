// The "bit ranges" part of a node: for every multi-bit pin the user opened, a bit strip to pick a
// range with the mouse, quick buttons, and one handle per range (`[4..7]`). It is a column next to
// the node: on the LEFT for pins that receive wires, on the RIGHT for pins that send wires, so the
// handles never overlap the pins of the chip itself.

import { useContext, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { rangeName } from '../engine/bus'
import { BoardContext } from './BoardContext'
import { normalizeRange, presetRanges, rangeHandleId, rangeWidth, type BitRange } from './ranges'
import type { PinIssue, PinRange } from './types'

export interface PinSection {
  pin: string // the pin's handle id ('a', 'out', 'in' ...)
  label: string // shown in the header, e.g. "a[16]"
  width: number
}

/** Bit strip: press on a bit and drag across the bits you want (or just click one bit). MSB on the left. */
function BitStrip({ width, covered, onPick }: { width: number; covered: boolean[]; onPick: (r: BitRange) => void }) {
  const [drag, setDrag] = useState<{ anchor: number; current: number } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  // The mouse button can be released anywhere, so listen on the window while a drag is active.
  const active = drag !== null
  useEffect(() => {
    if (!active) return
    const up = () => {
      const d = dragRef.current
      if (d) pickRef.current(normalizeRange(d.anchor, d.current))
      setDrag(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [active])

  const sel = drag ? normalizeRange(drag.anchor, drag.current) : null
  return (
    <div className="bit-strip nodrag nopan" role="group" aria-label="Bit strip: drag across the bits you want">
      {Array.from({ length: width }, (_, i) => {
        const bit = width - 1 - i
        const picked = sel !== null && bit >= sel.lo && bit <= sel.hi
        return (
          <div key={bit} className={`bs-col${bit % 4 === 3 && i > 0 ? ' group-start' : ''}`}>
            <span className="bs-index">{bit}</span>
            <div
              className={`bs-cell${picked ? ' picked' : covered[bit] ? ' covered' : ''}`}
              title={`Bit ${bit}: click, or drag across several bits, to make a range handle`}
              onPointerDown={(e) => {
                e.stopPropagation() // do not start dragging / selecting the node
                setDrag({ anchor: bit, current: bit })
              }}
              onPointerEnter={() => setDrag((d) => (d ? { ...d, current: bit } : d))}
            />
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  nodeId: string
  side: 'left' | 'right' // left: handles that RECEIVE wires (inputs); right: handles that SEND wires (outputs)
  pins: PinSection[] // the multi-bit pins of this node on this side
  ranges: PinRange[] // all range handles of the node
  open: Set<string> // pins whose bit strip is open
  onToggle: (pin: string) => void
  issues: PinIssue[]
}

export default function RangeColumn({ nodeId, side, pins, ranges, open, onToggle, issues }: Props) {
  const { addRanges, removeRange } = useContext(BoardContext)
  // A pin shows its section when its strip is open, it has range handles, or it has a problem to report.
  const sections = pins.filter((p) => open.has(p.pin) || ranges.some((r) => r.pin === p.pin) || issues.some((i) => i.pin === p.pin))
  if (sections.length === 0) return null

  return (
    <div className={`range-col ${side} nodrag nopan`}>
      {sections.map((p) => {
        const mine = ranges.filter((r) => r.pin === p.pin)
        const isOpen = open.has(p.pin)
        const covered = Array.from({ length: p.width }, (_, b) => mine.some((r) => b >= r.lo && b <= r.hi))
        const pinIssues = issues.filter((i) => i.pin === p.pin)
        return (
          <div key={p.pin} className={`range-sec${pinIssues.length ? ' bad' : ''}`}>
            <button
              type="button"
              className="range-head"
              onClick={() => onToggle(p.pin)}
              title={isOpen ? 'Close the bit strip' : 'Open the bit strip to pick bit ranges'}
            >
              <span>{isOpen ? '▾' : '▸'}</span> {p.label} <span className="muted">bit ranges</span>
            </button>
            {isOpen && (
              <>
                <BitStrip width={p.width} covered={covered} onPick={(r) => addRanges(nodeId, p.pin, [r], p.width)} />
                <div className="range-presets">
                  {(['bits', 'nibbles', 'bytes'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      title={`Create a handle for every ${preset === 'bits' ? 'bit' : preset === 'nibbles' ? '4-bit nibble' : 'byte'}`}
                      onClick={() => addRanges(nodeId, p.pin, presetRanges(p.width, preset), p.width)}
                    >
                      {preset === 'bits' ? 'Split to bits' : preset === 'nibbles' ? 'to nibbles' : 'to bytes'}
                    </button>
                  ))}
                </div>
              </>
            )}
            {mine.map((r) => (
              <div key={rangeHandleId(r)} className="range-row">
                <span className="range-label mono">{rangeName(r)}</span>
                <span className="range-w">{rangeWidth(r)} bit{rangeWidth(r) === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  className="range-x"
                  title="Remove this range handle (and the wires attached to it)"
                  onClick={() => removeRange(nodeId, r)}
                >
                  ×
                </button>
                <Handle
                  type={side === 'left' ? 'target' : 'source'}
                  position={side === 'left' ? Position.Left : Position.Right}
                  id={rangeHandleId(r)}
                />
              </div>
            ))}
            {pinIssues.map((i, k) => (
              <div key={k} className="range-issue" role="alert">
                ⚠ {i.message}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
