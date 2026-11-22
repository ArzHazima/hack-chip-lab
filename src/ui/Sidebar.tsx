import { useState, type DragEvent } from 'react'
import { CHIP_GROUPS } from '../engine/chips'
import { DRAG_MIME, type DragItem } from './types'

// HTML5 drag & drop: we stash a JSON description of the item in the drag event;
// the Board reads it back in its onDrop handler.
function startDrag(e: DragEvent, item: DragItem) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item))
  e.dataTransfer.effectAllowed = 'move'
}

/** `showPins`: the manual Input/Output pin items (hidden while a chip's pins are created automatically). */
const BUS_WIDTHS = Array.from({ length: 16 }, (_, i) => i + 1)

export default function Sidebar({ showPins }: { showPins: boolean }) {
  const [inName, setInName] = useState('a')
  const [inWidth, setInWidth] = useState(1)
  const [outName, setOutName] = useState('out')
  const [outWidth, setOutWidth] = useState(1)
  // Wiring nodes: bus width (1..16) and, for Split/Join, the ranges text ("" = every bit on its own).
  const [splitWidth, setSplitWidth] = useState(16)
  const [splitRanges, setSplitRanges] = useState('')
  const [joinWidth, setJoinWidth] = useState(16)
  const [joinRanges, setJoinRanges] = useState('')
  const [trueWidth, setTrueWidth] = useState(16)
  const [falseWidth, setFalseWidth] = useState(16)

  const widthSelect = (value: number, set: (w: number) => void, widths = [1, 2, 3, 8, 16]) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))} title="Bit width">
      {widths.map((w) => (
        <option key={w} value={w}>
          {w} bit{w > 1 ? 's' : ''}
        </option>
      ))}
    </select>
  )

  return (
    <aside className="sidebar">
      {showPins ? (
        <>
      <h3>Pins</h3>
      <div
        className="palette-item pin-item"
        draggable
        onDragStart={(e) => startDrag(e, { kind: 'inpin', name: inName, width: inWidth })}
      >
        <div className="pin-item-title">Input pin</div>
        <div className="pin-item-fields">
          <input value={inName} onChange={(e) => setInName(e.target.value)} aria-label="Input pin name" />
          {widthSelect(inWidth, setInWidth)}
        </div>
      </div>
      <div
        className="palette-item pin-item"
        draggable
        onDragStart={(e) => startDrag(e, { kind: 'outpin', name: outName, width: outWidth })}
      >
        <div className="pin-item-title">Output pin</div>
        <div className="pin-item-fields">
          <input value={outName} onChange={(e) => setOutName(e.target.value)} aria-label="Output pin name" />
          {widthSelect(outWidth, setOutWidth)}
        </div>
      </div>
        </>
      ) : (
        <p className="hint">The chip's input/output pins were created from its .hdl.</p>
      )}

      {/* Wiring: nodes that split a bus into bits/ranges, join them back, or give constants. */}
      <details open className="chip-group">
        <summary>Wiring</summary>
        {([
          ['Split', splitWidth, setSplitWidth, splitRanges, setSplitRanges, 'Outputs, e.g. 0..7, 8..15 (empty = every bit)'],
          ['Join', joinWidth, setJoinWidth, joinRanges, setJoinRanges, 'Inputs, e.g. 0..7, 8..15 (empty = every bit)'],
        ] as const).map(([type, width, setWidth, ranges, setRanges, hint]) => (
          <div
            key={type}
            className="palette-item pin-item"
            draggable
            onDragStart={(e) => startDrag(e, { kind: 'bus', type, params: { width, ranges } })}
          >
            <div className="pin-item-title">{type}</div>
            <div className="pin-item-fields">
              {widthSelect(width, setWidth, BUS_WIDTHS)}
              <input value={ranges} placeholder="bits" title={hint} onChange={(e) => setRanges(e.target.value)} aria-label={`${type} ranges`} />
            </div>
          </div>
        ))}
        {([
          ['true', true, trueWidth, setTrueWidth],
          ['false', false, falseWidth, setFalseWidth],
        ] as const).map(([label, ones, width, setWidth]) => (
          <div
            key={label}
            className="palette-item pin-item"
            draggable
            onDragStart={(e) => startDrag(e, { kind: 'bus', type: 'Const', params: { width, ones } })}
          >
            <div className="pin-item-title">{label} (constant)</div>
            <div className="pin-item-fields">{widthSelect(width, setWidth, BUS_WIDTHS)}</div>
          </div>
        ))}
      </details>

      {/* One collapsible section per Nand2Tetris project (<details> is built-in HTML). */}
      {CHIP_GROUPS.map((group) => (
        <details key={group.title} open className="chip-group">
          <summary>{group.title}</summary>
          {group.chips.map((name) => (
            <div
              key={name}
              className="palette-item"
              draggable
              onDragStart={(e) => startDrag(e, { kind: 'chip', type: name })}
            >
              {name}
            </div>
          ))}
        </details>
      ))}
      <p className="hint">Drag items onto the board. Name a pin before dragging it (names must match the .cmp columns).</p>
    </aside>
  )
}
