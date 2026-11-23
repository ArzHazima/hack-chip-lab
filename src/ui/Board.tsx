import { useCallback, useEffect, useRef, type DragEvent } from 'react'
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
  /** Changes when a different board is shown (another chip): the view is fitted to the new nodes. */
  fitKey: string
}

// useReactFlow() only works *inside* <ReactFlowProvider>, hence the two components.
function BoardInner({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDropItem, fitKey }: Props) {
  const { screenToFlowPosition, fitView } = useReactFlow()

  // ---- keep every node visible ----
  // Whenever the board changes size (window resized, results panel opened or closed ...) the view is
  // fitted to the nodes again, UNLESS the user has panned or zoomed by hand: then we leave their view
  // alone. The "fit view" button in the corner (or switching chip) hands control back to us.
  const wrapRef = useRef<HTMLDivElement>(null)
  const userMoved = useRef(false)
  const hasNodes = useRef(false)
  hasNodes.current = nodes.length > 0
  const fit = useCallback(() => void fitView({ padding: 0.12, maxZoom: 1.25, duration: 0 }), [fitView])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let frame = 0
    // ResizeObserver tells us when the board element changes size; wait one frame so layout is final.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!userMoved.current && hasNodes.current) fit()
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [fit])

  // A different chip's board: forget manual panning and fit to its nodes (after they were measured).
  useEffect(() => {
    userMoved.current = false
    const t = setTimeout(fit, 80)
    return () => clearTimeout(t)
  }, [fitKey, fit])

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
    <div className="board" ref={wrapRef}>
      {/* Shown only while the board is empty; clicks pass through to the board underneath. */}
      {nodes.length === 0 && (
        <div className="board-hint" aria-live="polite">
          Pick a chip on the left or drag gates here
        </div>
      )}
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
        // event is null for our own fitView calls and set when the user drags or zooms the view
        onMoveStart={(event) => {
          if (event) userMoved.current = true
        }}
        fitView
      >
        <Background />
        <Controls onFitView={() => (userMoved.current = false)} />
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
