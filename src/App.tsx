import { useCallback, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Edge,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import { parseCmp, type CmpFile } from './engine/cmp'
import { CircuitError } from './engine/simulate'
import { runTests, type TestRun } from './engine/runTests'
import Board from './ui/Board'
import ResultsTable from './ui/ResultsTable'
import Sidebar from './ui/Sidebar'
import TopBar from './ui/TopBar'
import { edgeWidth, flowToCircuit } from './ui/flowToCircuit'
import type { AppNode, DragItem } from './ui/types'
import './index.css'

const GREEN = '#16a34a'
const GRAY = '#9ca3af'

export default function App() {
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>([])
  const [cmp, setCmp] = useState<CmpFile | null>(null)
  const [cmpName, setCmpName] = useState<string | null>(null)
  const [run, setRun] = useState<TestRun | null>(null)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const nextId = useRef(1) // counter used to build unique node ids (And1, And2, ...)

  // Editing the circuit makes old results stale, so drop them. Moving/selecting
  // nodes does not change the circuit, so those change types are ignored.
  const clearRun = () => {
    setRun(null)
    setSelectedRow(null)
  }
  const onNodesChange: OnNodesChange<AppNode> = (changes) => {
    onNodesChangeRaw(changes)
    if (changes.toArray().some((c) => c.type === 'remove' || c.type === 'add')) clearRun()
  }
  const onEdgesChange: OnEdgesChange = (changes) => {
    onEdgesChangeRaw(changes)
    if (changes.toArray().some((c) => c.type === 'remove' || c.type === 'add')) clearRun()
  }
  const onConnect: OnConnect = useCallback(
    (conn) => {
      setEdges((eds) => addEdge(conn, eds))
      setRun(null)
      setSelectedRow(null)
    },
    [setEdges],
  )

  const onDropItem = (item: DragItem, position: { x: number; y: number }) => {
    const n = nextId.current++
    if (item.kind === 'chip') {
      setNodes((ns) => [...ns, { id: `${item.type}${n}`, type: 'chip', position, data: { type: item.type } }])
    } else {
      const name = item.name.trim() || (item.kind === 'inpin' ? 'in' : 'out')
      setNodes((ns) => [
        ...ns,
        { id: `${item.kind}${n}`, type: item.kind, position, data: { name, width: item.width } },
      ])
    }
    clearRun()
  }

  const onUpload = async (file: File) => {
    try {
      setCmp(parseCmp(await file.text()))
      setCmpName(file.name)
      setErrors([])
      clearRun()
    } catch (e) {
      setErrors([`Could not read ${file.name}: ${(e as Error).message}`])
    }
  }

  const onRun = () => {
    clearRun()
    if (!cmp) return setErrors(['Upload a .cmp file first.'])
    const { circuit, errors: pinErrors } = flowToCircuit(nodes, edges)
    if (pinErrors.length) return setErrors(pinErrors)
    try {
      const result = runTests(circuit, cmp)
      setErrors([])
      setRun(result)
    } catch (e) {
      // CircuitError carries a list of user-fixable problems; anything else is a real bug.
      if (e instanceof CircuitError) setErrors(e.errors)
      else setErrors([`Unexpected error: ${(e as Error).message}`])
    }
  }

  // What the board shows: the stored graph, plus colors/values for the selected result row.
  // Computed on the fly (useMemo) so the real nodes/edges state stays clean.
  const row = run && selectedRow !== null ? run.rows[selectedRow] : null
  const shownNodes = useMemo<AppNode[]>(
    () =>
      nodes.map((n) => {
        if (n.type === 'chip') return n
        const value = row ? (n.type === 'inpin' ? row.inputs : row.actual)[n.data.name] : undefined
        return { ...n, data: { ...n.data, value } } as AppNode
      }),
    [nodes, row],
  )
  const shownEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => {
        const v = row?.wireValues[e.id]
        if (v === undefined) return e
        const width = edgeWidth(nodes, e)
        return {
          ...e,
          animated: false,
          style: { stroke: v ? GREEN : GRAY, strokeWidth: 2.5 },
          // Buses (width > 1) show their numeric value on the wire.
          label: width > 1 ? String(v) : undefined,
          labelStyle: { fontWeight: 700, fill: v ? GREEN : '#555' },
        }
      }),
    [edges, nodes, row],
  )

  const widths = useMemo(
    () => Object.fromEntries((cmp?.columns ?? []).map((c, i) => [c, cmp!.widths[i]])),
    [cmp],
  )

  return (
    <div className="app">
      <TopBar cmpName={cmpName} onUpload={onUpload} onRun={onRun} />
      {errors.length > 0 && (
        <div className="error-banner" role="alert">
          <strong>Can't run:</strong>
          <ul>
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="main">
        <Sidebar />
        <div className="center">
          <Board
            nodes={shownNodes}
            edges={shownEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDropItem={onDropItem}
          />
          {run && <ResultsTable run={run} widths={widths} selected={selectedRow} onSelect={setSelectedRow} />}
        </div>
      </div>
    </div>
  )
}
