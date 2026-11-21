import type { DragEvent } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes'
import { DRAG_MIME, type AppNode, type DragItem } from './types'

interface Props {
  nodes: AppNode[]
  edges: Edge[]
  onNodesChange: OnNodesChange<AppNode>
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  onDropItem: (item: DragItem, position: { x: number; y: number }) => void
}

// useReactFlow() only works *inside* <ReactFlowProvider>, hence the two components.
function BoardInner({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDropItem }: Props) {
  const { screenToFlowPosition } = useReactFlow()

  const onDragOver = (e: DragEvent) => {
    e.preventDefault() // required, otherwise the browser refuses the drop
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    // Convert screen pixels to canvas coordinates (accounts for pan/zoom).
    onDropItem(JSON.parse(raw) as DragItem, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }

  return (
    <div className="board">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        deleteKeyCode={null} // App handles Delete/Backspace itself (see deleteSelected)
        defaultEdgeOptions={{ interactionWidth: 20 }} // wide invisible click area around each wire
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export default function Board(props: Props) {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  )
}
