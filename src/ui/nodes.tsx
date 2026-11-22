// Custom React Flow nodes. A <Handle> is a connection point; its `id` is how the
// engine knows which pin a wire is attached to (chip pin name, or 'in'/'out' for board pins).

import { useContext, useMemo, type CSSProperties, type ReactNode } from 'react'
import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react'
import { BoardContext } from './BoardContext'
import { chipLayout, LEAD, type ChipLayout } from './chipLayout'
import type { ChipNodeT, InPinNodeT, OutPinNodeT } from './types'

const label = (name: string, width: number) => (width > 1 ? `${name}[${width}]` : name)

// The drawn symbol (just the SVG): body outline plus the short lead line of every pin.
function ChipSymbol({ layout }: { layout: ChipLayout }) {
  const { shape, w, h, pins, lines } = layout
  const L = LEAD
  let body: ReactNode
  switch (shape) {
    case 'and': // D shape: flat left side, semicircle on the right
      body = <path className="sym" d={`M${L} 4 H52 A24 24 0 0 1 52 52 H${L} Z`} />
      break
    case 'nand': // D shape ending 8px early, then the inversion bubble
      body = (
        <>
          <path className="sym" d={`M${L} 4 H44 A24 24 0 0 1 44 52 H${L} Z`} />
          <circle className="sym" cx={72} cy={28} r={4} />
        </>
      )
      break
    case 'or': // curved shield: concave back, pointed front
      body = <path className="sym" d={`M${L} 4 Q42 4 76 28 Q42 52 ${L} 52 Q28 28 ${L} 4 Z`} />
      break
    case 'xor': // Or shield shifted right + one extra curved line on the input side
      body = (
        <>
          <path className="sym" d="M20 4 Q46 4 76 28 Q46 52 20 52 Q34 28 20 4 Z" />
          <path className="sym nofill" d={`M${L} 4 Q28 28 ${L} 52`} />
        </>
      )
      break
    case 'not': // triangle + bubble
      body = (
        <>
          <path className="sym" d={`M${L} 6 L68 28 L${L} 50 Z`} />
          <circle className="sym" cx={72} cy={28} r={4} />
        </>
      )
      break
    case 'mux': // trapezoid, wide left side
      body = <polygon className="sym" points={`${L},0 ${w - L},${h * 0.2} ${w - L},${h * 0.8} ${L},${h}`} />
      break
    case 'dmux': // mirrored trapezoid, wide right side
      body = <polygon className="sym" points={`${L},${h * 0.2} ${w - L},0 ${w - L},${h} ${L},${h * 0.8}`} />
      break
    default: // rounded rectangle
      body = <rect className="sym" x={L} y={2} width={w - 2 * L} height={h - 4} rx={8} />
  }
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
      {body}
      {pins.map((p) => (
        // Lead line: joins the handle (on the box edge) to the symbol outline.
        // 16-bit pins are drawn thicker, like the 16-bit wires.
        <line
          key={p.name}
          className="lead"
          x1={p.x} y1={p.y} x2={p.leadX} y2={p.leadY}
          strokeWidth={p.width > 1 ? 4 : 2}
        />
      ))}
      {lines.map((t, i) => (
        <text key={t} className="sym-text" x={w / 2} y={h / 2 + (shape === 'dmux' ? 24 : 0) + (i - (lines.length - 1) / 2) * 12 + 4} textAnchor="middle">
          {t}
        </text>
      ))}
    </svg>
  )
}

function ChipNode({ data }: NodeProps<ChipNodeT>) {
  const layout = useMemo(() => chipLayout(data.type, data.params), [data.type, data.params])
  const { shape, w, h, pins } = layout
  const isBox = shape === 'box'
  // Output labels sit above the lead line on gates/Mux (the symbol's tip is in the way);
  // on DMux and boxes there is room to put them inside, next to the pin.
  const outAbove = !isBox && shape !== 'dmux'

  return (
    <div className="chip-node" title={data.type}>
      {(!isBox || data.stored !== undefined) && (
        <div className="chip-caption">
          {!isBox && data.type}
          {/* Live stored value of a DFF / PC (only while the clock simulation is active). */}
          {data.stored !== undefined && <b className="stored">stored: {data.stored}</b>}
        </div>
      )}
      <div className="chip-symbol" style={{ width: w, height: h }}>
        <ChipSymbol layout={layout} />
        {isBox && (
          <div className="box-title" style={{ width: w }}>
            {layout.title ?? data.type}
          </div>
        )}
        {pins.map((p) => {
          // Symbols mark buses with thick leads; only boxes spell out the width.
          // Range pins of Split/Join are already named "[0..7]"; the others get "[16]" appended.
          const text = isBox && !p.name.startsWith('[') ? label(p.name, p.width) : p.name
          let style: CSSProperties
          if (p.side === 'bottom') style = { left: p.x + 4, top: p.y - 13 }
          else if (p.io === 'in') style = { left: p.leadX + 3, top: p.y - 6 }
          else if (outAbove) style = { right: 0, top: p.y - 15 }
          else style = { right: LEAD + 3, top: p.y - 6 }
          return (
            <span key={p.name} className="pin-label" style={style}>
              {text}
            </span>
          )
        })}
        {pins.map((p) => (
          <Handle
            key={p.name}
            id={p.name}
            type={p.io === 'in' ? 'target' : 'source'}
            position={p.side === 'left' ? Position.Left : p.side === 'right' ? Position.Right : Position.Bottom}
            // Override the default (centred) position so the handle sits where the layout says.
            style={p.side === 'bottom' ? { left: p.x } : { top: p.y }}
          />
        ))}
      </div>
    </div>
  )
}

function InputPinNode({ id, data }: NodeProps<InPinNodeT>) {
  const { setInputValue } = useContext(BoardContext)
  const max = 2 ** data.width - 1
  return (
    <div className="board-pin in">
      <span>{label(data.name, data.width)}</span>
      {/* Value fed to this pin by Tick / Tock / Step. `nodrag` keeps typing from dragging the node. */}
      <input
        className="pin-input nodrag"
        type="number"
        min={0}
        max={max}
        value={data.inputValue ?? 0}
        aria-label={`Value of ${data.name}`}
        onChange={(e) => setInputValue(id, Math.min(max, Math.max(0, Math.floor(Number(e.target.value)) || 0)))}
      />
      {data.value !== undefined && <b className="pin-value">{data.value}</b>}
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

function OutputPinNode({ data }: NodeProps<OutPinNodeT>) {
  return (
    <div className="board-pin out">
      <Handle type="target" position={Position.Left} id="in" />
      <span>{label(data.name, data.width)}</span>
      {data.value !== undefined && <b className="pin-value">{data.value}</b>}
    </div>
  )
}

export const nodeTypes = {
  chip: ChipNode,
  inpin: InputPinNode,
  outpin: OutputPinNode,
} as NodeTypes
