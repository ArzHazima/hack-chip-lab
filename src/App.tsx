import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { CircuitError, hasSequential } from './engine/simulate'
import { Simulator } from './engine/sequential'
import { runTests, type TestRun } from './engine/runTests'
import Board from './ui/Board'
import ExpectedPanel from './ui/ExpectedPanel'
import ResultsTable from './ui/ResultsTable'
import Sidebar from './ui/Sidebar'
import TopBar from './ui/TopBar'
import { BoardContext } from './ui/BoardContext'
import { edgeWidth, flowToCircuit, inputValues } from './ui/flowToCircuit'
import type { AppNode, DragItem } from './ui/types'
import './index.css'

const GREEN = '#16a34a'
const GRAY = '#9ca3af'

export default function App() {
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>([])
  const [cmp, setCmp] = useState<CmpFile | null>(null)
  const [cmpName, setCmpName] = useState<string | null>(null)
  const [showExpected, setShowExpected] = useState(false)
  const [run, setRun] = useState<TestRun | null>(null)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const nextId = useRef(1) // counter used to build unique node ids (And1, And2, ...)

  // The clocked simulation lives in a ref (it is a mutable object with its own state);
  // `clockTick` is a counter we bump to make React re-render after the clock moves.
  const simRef = useRef<Simulator | null>(null)
  const [clockTick, setClockTick] = useState(0)

  // Editing the circuit makes old results stale, so drop them. Moving/selecting
  // nodes does not change the circuit, so those change types are ignored.
  const clearRun = () => {
    setRun(null)
    setSelectedRow(null)
  }
  // A structural edit also invalidates the running clock simulation (stored values
  // belong to the old circuit), so it starts over at time 0.
  const structuralChange = useCallback(() => {
    setRun(null)
    setSelectedRow(null)
    simRef.current = null
    setClockTick((n) => n + 1)
  }, [])
  const onNodesChange: OnNodesChange<AppNode> = (changes) => {
    onNodesChangeRaw(changes)
    if (changes.toArray().some((c) => c.type === 'remove' || c.type === 'add')) structuralChange()
  }
  const onEdgesChange: OnEdgesChange = (changes) => {
    onEdgesChangeRaw(changes)
    if (changes.toArray().some((c) => c.type === 'remove' || c.type === 'add')) structuralChange()
  }
  const onConnect: OnConnect = useCallback(
    (conn) => {
      setEdges((eds) => addEdge(conn, eds))
      structuralChange()
    },
    [setEdges, structuralChange],
  )

  const setInputValue = useCallback(
    (nodeId: string, value: number) =>
      setNodes((ns) =>
        ns.map((n) => (n.id === nodeId && n.type === 'inpin' ? { ...n, data: { ...n.data, inputValue: value } } : n)),
      ),
    [setNodes],
  )
  const boardContext = useMemo(() => ({ setInputValue }), [setInputValue])

  // ---- Deleting the selection (nodes and wires) ----
  // We handle Delete/Backspace ourselves instead of relying on React Flow's key handler,
  // which only fires reliably when the right element has keyboard focus.
  const hasSelection = nodes.some((n) => n.selected) || edges.some((e) => e.selected)
  const deleteSelected = useCallback(() => {
    const gone = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    if (gone.size === 0 && !edges.some((e) => e.selected)) return
    setNodes((ns) => ns.filter((n) => !gone.has(n.id)))
    // A wire goes away if it is selected itself OR touches a deleted node.
    setEdges((es) => es.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)))
    structuralChange()
  }, [nodes, edges, setNodes, setEdges, structuralChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // Never steal the key while the user is typing (pin names, the pin value box ...).
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return
      e.preventDefault() // Backspace must not navigate "back" in some browsers
      deleteSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSelected])

  const showError = (e: unknown) =>
    setErrors(e instanceof CircuitError ? e.errors : [`Unexpected error: ${(e as Error).message}`])

  /** Builds the Simulator the first time the clock is used (reports circuit errors). */
  const ensureSim = (): Simulator | null => {
    if (simRef.current) return simRef.current
    const { circuit, errors: pinErrors } = flowToCircuit(nodes, edges)
    if (pinErrors.length) {
      setErrors(pinErrors)
      return null
    }
    try {
      simRef.current = new Simulator(circuit)
      setErrors([])
      return simRef.current
    } catch (e) {
      showError(e)
      return null
    }
  }

  const onClock = (action: 'tick' | 'tock' | 'step' | 'reset') => {
    const sim = ensureSim()
    if (!sim) return
    clearRun() // the clocked view replaces any selected result row
    try {
      if (action === 'reset') sim.reset()
      else sim[action](inputValues(nodes))
      setErrors([])
    } catch (e) {
      showError(e)
    }
    setClockTick((n) => n + 1)
  }

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
    structuralChange()
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
    if (hasSequential(circuit)) {
      return setErrors([
        'This circuit contains clocked chips (DFF, RAM, PC ...). Run only checks combinational .cmp rows; ' +
          'use Tick / Tock / Step to clock it.',
      ])
    }
    try {
      const result = runTests(circuit, cmp)
      setErrors([])
      setRun(result)
    } catch (e) {
      // CircuitError carries a list of user-fixable problems; anything else is a real bug.
      showError(e)
    }
  }

  // Live clocked view: current outputs, wire values and stored DFF/PC values.
  // eval() never changes state, so it is safe to recompute whenever inputs or the clock change.
  const live = useMemo(() => {
    const sim = simRef.current
    if (!sim) return null
    try {
      return { result: sim.eval(inputValues(nodes)), stored: sim.stored(), time: sim.time }
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, clockTick])

  // What the board shows: the stored graph, plus colors/values from EITHER the selected
  // result row OR the live clocked simulation. Computed on the fly (useMemo) so the real
  // nodes/edges state stays clean.
  const row = run && selectedRow !== null ? run.rows[selectedRow] : null
  const view = useMemo(
    () =>
      row
        ? { outputs: row.actual, wires: row.wireValues, rowInputs: row.inputs, stored: undefined }
        : live
          ? { outputs: live.result.outputs, wires: live.result.wireValues, rowInputs: undefined, stored: live.stored }
          : null,
    [row, live],
  )
  const shownNodes = useMemo<AppNode[]>(
    () =>
      nodes.map((n) => {
        if (n.type === 'chip') {
          const stored = view?.stored?.[n.id]
          return stored === undefined ? n : { ...n, data: { ...n.data, stored } }
        }
        // Input pins show a value badge only for a result row; live inputs are typed into the pin box.
        const value = n.type === 'inpin' ? view?.rowInputs?.[n.data.name] : view?.outputs[n.data.name]
        return { ...n, data: { ...n.data, value } } as AppNode
      }),
    [nodes, view],
  )
  const shownEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => {
        const width = edgeWidth(nodes, e)
        const thickness = (width > 1 ? 4 : 2) + (e.selected ? 1.5 : 0) // 16-bit buses are drawn thicker
        // Selected wires get an amber glow (our inline stroke would hide React Flow's own highlight).
        const glow = e.selected ? { filter: 'drop-shadow(0 0 3px #f59e0b)' } : {}
        const v = view?.wires[e.id]
        if (v === undefined) {
          return { ...e, style: { stroke: e.selected ? '#f59e0b' : '#6b7280', strokeWidth: thickness, ...glow } }
        }
        return {
          ...e,
          animated: false,
          style: { stroke: v ? GREEN : GRAY, strokeWidth: thickness, ...glow },
          // Buses (width > 1) show their numeric value on the wire.
          label: width > 1 ? String(v) : undefined,
          labelStyle: { fontWeight: 700, fill: v ? GREEN : '#555' },
        }
      }),
    [edges, nodes, view],
  )

  const widths = useMemo(
    () => Object.fromEntries((cmp?.columns ?? []).map((c, i) => [c, cmp!.widths[i]])),
    [cmp],
  )

  return (
    <div className="app">
      <TopBar
        cmpName={cmpName}
        showExpected={showExpected}
        onUpload={onUpload}
        onRun={onRun}
        onToggleExpected={() => setShowExpected((s) => !s)}
        clockTime={live?.time ?? '0'}
        onTick={() => onClock('tick')}
        onTock={() => onClock('tock')}
        onStep={() => onClock('step')}
        onReset={() => onClock('reset')}
        hasSelection={hasSelection}
        onDeleteSelected={deleteSelected}
      />
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
          <BoardContext.Provider value={boardContext}>
            <Board
              nodes={shownNodes}
              edges={shownEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDropItem={onDropItem}
            />
          </BoardContext.Provider>
          {run && <ResultsTable run={run} widths={widths} selected={selectedRow} onSelect={setSelectedRow} />}
        </div>
        {showExpected && cmp && cmpName && <ExpectedPanel cmp={cmp} fileName={cmpName} />}
      </div>
    </div>
  )
}
