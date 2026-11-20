// Custom React Flow nodes. A <Handle> is a connection point; its `id` is how the
// engine knows which pin a wire is attached to (chip pin name, or 'in'/'out' for board pins).

import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react'
import { CHIPS } from '../engine/chips'
import type { ChipNodeT, InPinNodeT, OutPinNodeT } from './types'

const label = (name: string, width: number) => (width > 1 ? `${name}[${width}]` : name)

function ChipNode({ data }: NodeProps<ChipNodeT>) {
  const def = CHIPS[data.type]
  return (
    <div className="chip-node">
      <div className="chip-title">{data.type}</div>
      <div className="chip-body">
        <div className="pin-col">
          {def.inputs.map((p) => (
            <div className="pin-row" key={p.name}>
              <Handle type="target" position={Position.Left} id={p.name} />
              <span>{label(p.name, p.width)}</span>
            </div>
          ))}
        </div>
        <div className="pin-col right">
          {def.outputs.map((p) => (
            <div className="pin-row" key={p.name}>
              <span>{label(p.name, p.width)}</span>
              <Handle type="source" position={Position.Right} id={p.name} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function InputPinNode({ data }: NodeProps<InPinNodeT>) {
  return (
    <div className="board-pin in">
      <span>{label(data.name, data.width)}</span>
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
