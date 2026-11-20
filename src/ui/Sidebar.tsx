import { useState, type DragEvent } from 'react'
import { CHIP_GROUPS } from '../engine/chips'
import { DRAG_MIME, type DragItem } from './types'

// HTML5 drag & drop: we stash a JSON description of the item in the drag event;
// the Board reads it back in its onDrop handler.
function startDrag(e: DragEvent, item: DragItem) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item))
  e.dataTransfer.effectAllowed = 'move'
}

export default function Sidebar() {
  const [inName, setInName] = useState('a')
  const [inWidth, setInWidth] = useState(1)
  const [outName, setOutName] = useState('out')
  const [outWidth, setOutWidth] = useState(1)

  const widthSelect = (value: number, set: (w: number) => void) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))} title="Bit width">
      {[1, 2, 3, 8, 16].map((w) => (
        <option key={w} value={w}>
          {w} bit{w > 1 ? 's' : ''}
        </option>
      ))}
    </select>
  )

  return (
    <aside className="sidebar">
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
