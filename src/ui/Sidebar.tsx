import { useState, type DragEvent, type ReactNode } from 'react'
import { CHIP_GROUPS } from '../engine/chips'
import type { ExerciseChip } from '../engine/exercise'
import { DRAG_MIME, type DragItem } from './types'

// HTML5 drag & drop: we stash a JSON description of the item in the drag event;
// the Board reads it back in its onDrop handler.
function startDrag(e: DragEvent, item: DragItem) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item))
  e.dataTransfer.effectAllowed = 'move'
}

const BUS_WIDTHS = Array.from({ length: 16 }, (_, i) => i + 1)

/** A collapsible, clearly titled section (<details> is built-in HTML, so it works without JavaScript state). */
function Section({ title, count, hint, children, open = true }: { title: string; count?: number; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="side-section" open={open}>
      <summary>
        <span className="side-title">{title}</span>
        {count !== undefined && <span className="side-count">{count}</span>}
      </summary>
      {hint && <p className="side-hint">{hint}</p>}
      <div className="side-body">{children}</div>
    </details>
  )
}

interface Props {
  chips: ExerciseChip[]
  activeName: string | null
  onSelectChip: (name: string | null) => void
  /** The manual Input/Output pin items (hidden while a chip's pins are created automatically). */
  showPins: boolean
}

export default function Sidebar({ chips, activeName, onSelectChip, showPins }: Props) {
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
    <select value={value} onChange={(e) => set(Number(e.target.value))} title="Bit width" aria-label="Bit width">
      {widths.map((w) => (
        <option key={w} value={w}>
          {w} bit{w > 1 ? 's' : ''}
        </option>
      ))}
    </select>
  )

  return (
    <aside className="sidebar" aria-label="Palette">
      <p className="side-intro">Drag items onto the board.</p>

      {chips.length > 0 && (
        <Section title="From your folder" count={chips.length} hint="Click a chip to build it. ⚠ = a file is missing.">
          <div className="chip-list">
            {chips.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`chip-pick${c.name === activeName ? ' active' : ''}`}
                title={c.missing.length ? `Missing: ${c.missing.map((m) => `${c.name}.${m}`).join(', ')}` : `Build ${c.name}`}
                aria-pressed={c.name === activeName}
                onClick={() => onSelectChip(c.name === activeName ? null : c.name)}
              >
                {c.missing.length > 0 && <span aria-hidden>⚠ </span>}
                {c.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      {showPins ? (
        <Section title="Pins" hint="Name a pin, then drag it onto the board. Names must match the .cmp columns.">
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
        </Section>
      ) : (
        <p className="side-hint boxed">The chip’s input and output pins were created from its .hdl.</p>
      )}

      <Section title="Wiring" hint="Split a bus into bits or ranges, join them back, or add constants.">
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
              <input value={ranges} placeholder="all bits" title={hint} onChange={(e) => setRanges(e.target.value)} aria-label={`${type} ranges`} />
            </div>
          </div>
        ))}
        {([
          ['true', true, trueWidth, setTrueWidth],
          ['false', false, falseWidth, setFalseWidth],
        ] as const).map(([name, ones, width, setWidth]) => (
          <div
            key={name}
            className="palette-item pin-item"
            draggable
            onDragStart={(e) => startDrag(e, { kind: 'bus', type: 'Const', params: { width, ones } })}
          >
            <div className="pin-item-title">{name} (constant)</div>
            <div className="pin-item-fields">{widthSelect(width, setWidth, BUS_WIDTHS)}</div>
          </div>
        ))}
      </Section>

      {/* One collapsible section per Nand2Tetris project; chips in a compact two-column grid. */}
      {CHIP_GROUPS.map((group) => (
        <Section key={group.title} title={group.title} count={group.chips.length}>
          <div className="palette-grid">
            {group.chips.map((name) => (
              <div
                key={name}
                className="palette-item chip-item"
                draggable
                title={`Drag ${name} onto the board`}
                onDragStart={(e) => startDrag(e, { kind: 'chip', type: name })}
              >
                {name}
              </div>
            ))}
          </div>
        </Section>
      ))}
    </aside>
  )
}
