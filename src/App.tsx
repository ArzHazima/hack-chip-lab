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
import { CmpParseError, cmpTextTable, parseCmp, type CmpFile } from './engine/cmp'
import { groupExerciseFiles, runExercise, type ExerciseChip } from './engine/exercise'
import { HdlParseError, parseHdlInterface } from './engine/hdl'
import { runTests } from './engine/runTests'
import { Simulator } from './engine/sequential'
import { CircuitError, hasSequential } from './engine/simulate'
import { TstParseError } from './engine/tst'
import Board from './ui/Board'
import { BoardContext } from './ui/BoardContext'
import ChipBanner from './ui/ChipBanner'
import ExpectedPanel, { type ExpectedTable } from './ui/ExpectedPanel'
import ResultsTable from './ui/ResultsTable'
import Sidebar from './ui/Sidebar'
import TopBar from './ui/TopBar'
import { maxIdNumber, pinsFromInterface, reconcilePins } from './ui/exercisePins'
import { filesFromDrop, hasFiles, readExerciseFiles } from './ui/fileLoading'
import { edgeWidth, flowToCircuit, inputValues } from './ui/flowToCircuit'
import { fromExercise, fromTestRun } from './ui/runView'
import { loadCircuit, MANUAL_SLOT, saveCircuit, type SavedCircuit } from './ui/storage'
import type { AppNode, DragItem, RunView } from './ui/types'
import './index.css'

const GREEN = '#16a34a'
const GRAY = '#9ca3af'

/** Saved/restored graphs must not come back with stale selection highlights. */
const deselect = <T extends { selected?: boolean }>(items: T[]): T[] => items.map((i) => ({ ...i, selected: false }))

export default function App() {
  // The manual board (no chip selected) is restored from the previous visit.
  const [initial] = useState(() => loadCircuit(MANUAL_SLOT))
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<AppNode>(deselect(initial?.nodes ?? []))
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>(deselect(initial?.edges ?? []))
  const nextId = useRef(maxIdNumber(initial?.nodes ?? []) + 1) // unique node ids (And1, And2, ...)

  // Exercise chips loaded from a folder, and which one is active (null = manual mode).
  const [exercises, setExercises] = useState<ExerciseChip[]>([])
  const [activeName, setActiveName] = useState<string | null>(null)
  const [autoPins, setAutoPins] = useState(false) // true when the pins came from the chip's .hdl
  const active = useMemo(() => exercises.find((c) => c.name === activeName) ?? null, [exercises, activeName])
  // Every slot's circuit lives here while the page is open (and in localStorage across visits).
  const memory = useRef(new Map<string, SavedCircuit>())

  // Manual mode: a .cmp uploaded by hand.
  const [cmp, setCmp] = useState<CmpFile | null>(null)
  const [cmpName, setCmpName] = useState<string | null>(null)

  const [showExpected, setShowExpected] = useState(false)
  const [run, setRun] = useState<RunView | null>(null)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

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

  // ---- Per-chip circuits: save current, restore another ----
  const persist = () => {
    const slot = activeName ?? MANUAL_SLOT
    const data: SavedCircuit = { nodes: deselect(nodes), edges: deselect(edges) }
    memory.current.set(slot, data)
    saveCircuit(slot, data) // try/catch inside: works without localStorage
  }
  // Autosave a moment after the last change, and when the tab is closed.
  const persistRef = useRef(persist)
  persistRef.current = persist
  useEffect(() => {
    const t = setTimeout(() => persistRef.current(), 400)
    return () => clearTimeout(t)
  }, [nodes, edges, activeName])
  useEffect(() => {
    const save = () => persistRef.current()
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [])

  /** Make `target` (a chip name, or null for manual mode) the active board. */
  const switchTo = (target: string | null, list: ExerciseChip[] = exercises) => {
    persist() // keep what the user built for the chip we are leaving
    const slot = target ?? MANUAL_SLOT
    const chip = target ? (list.find((c) => c.name === target) ?? null) : null
    const saved = memory.current.get(slot) ?? loadCircuit(slot)
    let nextNodes = saved?.nodes ?? []
    let nextEdges = saved?.edges ?? []
    nextId.current = Math.max(nextId.current, maxIdNumber(nextNodes) + 1)
    const newId = () => nextId.current++

    let auto = false
    const problems: string[] = []
    if (chip?.hdl) {
      try {
        // Only the interface (IN/OUT) is read; PARTS is ignored on purpose.
        const iface = parseHdlInterface(chip.hdl.text)
        if (saved) ({ nodes: nextNodes, edges: nextEdges } = reconcilePins(nextNodes, nextEdges, iface, newId))
        else nextNodes = pinsFromInterface(iface, newId)
        auto = true
      } catch (e) {
        problems.push(`${chip.hdl.name}: ${(e as Error).message}. Add the pins by hand.`)
      }
    } else if (chip) {
      problems.push(`⚠ ${chip.name}.hdl is missing, so the pins cannot be created automatically. Add them by hand.`)
    }

    setNodes(deselect(nextNodes))
    setEdges(deselect(nextEdges))
    setActiveName(target)
    setAutoPins(auto)
    setErrors(problems)
    setWarnings([])
    structuralChange()
  }

  const onLoadFiles = async (files: File[]) => {
    try {
      const list = groupExerciseFiles(await readExerciseFiles(files))
      if (list.length === 0) {
        setErrors(['No .hdl, .tst or .cmp files were found in what you picked.'])
        return
      }
      setExercises(list)
      setErrors([])
      setWarnings([])
      // Keep the active chip if it is still there (its files may have changed), else go back to manual.
      if (activeName) switchTo(list.some((c) => c.name === activeName) ? activeName : null, list)
    } catch (e) {
      setErrors([`Could not read the files: ${(e as Error).message}`])
    }
  }

  const showError = (e: unknown) => {
    if (e instanceof CircuitError) setErrors(e.errors)
    else if (e instanceof TstParseError) setErrors([`Problem in the .tst file: ${e.message}`])
    else if (e instanceof CmpParseError) setErrors([`Problem in the .cmp file: ${e.message}`])
    else if (e instanceof HdlParseError) setErrors([`Problem in the .hdl file: ${e.message}`])
    else setErrors([`Unexpected error: ${(e as Error).message}`])
  }

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
    } else if (item.kind === 'bus') {
      // Split / Join / Const: a chip node whose pins come from its settings.
      setNodes((ns) => [
        ...ns,
        { id: `${item.type}${n}`, type: 'chip', position, data: { type: item.type, params: item.params } },
      ])
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
    setWarnings([])
    const { circuit, errors: pinErrors } = flowToCircuit(nodes, edges)
    const needsTst = [
      'This circuit contains clocked chips (DFF, RAM, PC ...). Run needs a .tst script to clock it ' +
        '(or use Tick / Tock / Step by hand).',
    ]
    try {
      if (active) {
        // ---- chip flow: the chip's own .tst and .cmp ----
        if (!active.cmp) return setErrors([`⚠ ${active.name}.cmp is missing, so there is nothing to compare with.`])
        if (pinErrors.length) return setErrors(pinErrors)
        if (active.tst) {
          const result = runExercise(circuit, active.tst.text, active.cmp.text)
          setErrors([])
          setWarnings(result.warnings.map((w) => `${active.tst!.name}: ${w}`))
          return setRun(fromExercise(result))
        }
        // No .tst: treat the .cmp as a plain combinational table.
        const table = parseCmp(active.cmp.text)
        if (hasSequential(circuit)) return setErrors(needsTst)
        const widths = Object.fromEntries(table.columns.map((c, i) => [c, table.widths[i]]))
        setErrors([])
        return setRun(fromTestRun(runTests(circuit, table), widths))
      }
      // ---- manual flow: a .cmp uploaded by hand ----
      if (!cmp) return setErrors(['Upload a .cmp file first (or load a folder and pick a chip).'])
      if (pinErrors.length) return setErrors(pinErrors)
      if (hasSequential(circuit)) return setErrors(needsTst)
      const widths = Object.fromEntries(cmp.columns.map((c, i) => [c, cmp.widths[i]]))
      setErrors([])
      setRun(fromTestRun(runTests(circuit, cmp), widths))
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
  const snap = run && selectedRow !== null ? run.rows[selectedRow]?.snap : undefined
  const view = useMemo(
    () =>
      snap
        ? { outputs: snap.outputs, wires: snap.wireValues, rowInputs: snap.inputs, stored: undefined }
        : live
          ? { outputs: live.result.outputs, wires: live.result.wireValues, rowInputs: undefined, stored: live.stored }
          : null,
    [snap, live],
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

  // The expected table: the active chip's .cmp (any format), or the manually uploaded one.
  const expectedTable = useMemo<ExpectedTable | null>(() => {
    try {
      if (active?.cmp) return { title: active.cmp.name, ...cmpTextTable(active.cmp.text) }
      if (!active && cmp && cmpName) {
        return {
          title: cmpName,
          columns: cmp.columns,
          rows: cmp.rows.map((r) => r.values.map((v, j) => v.toString(2).padStart(cmp.widths[j], '0'))),
        }
      }
    } catch {
      /* unreadable .cmp: Run reports the details */
    }
    return null
  }, [active, cmp, cmpName])

  const onRootDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return // chips dragged from the palette are handled by the board
    e.preventDefault()
    onLoadFiles(await filesFromDrop(e.dataTransfer)) // entries are read synchronously inside
  }

  return (
    <div
      className="app"
      onDragOver={(e) => hasFiles(e.dataTransfer) && e.preventDefault()}
      onDrop={onRootDrop}
    >
      <TopBar
        chips={exercises}
        activeName={activeName}
        onSelectChip={(name) => switchTo(name)}
        onLoadFiles={onLoadFiles}
        cmpName={cmpName}
        onUpload={onUpload}
        canShowExpected={expectedTable !== null}
        showExpected={showExpected}
        onToggleExpected={() => setShowExpected((s) => !s)}
        clockTime={live?.time ?? '0'}
        onTick={() => onClock('tick')}
        onTock={() => onClock('tock')}
        onStep={() => onClock('step')}
        onReset={() => onClock('reset')}
        hasSelection={hasSelection}
        onDeleteSelected={deleteSelected}
        onRun={onRun}
      />
      {errors.length > 0 && (
        <div className="error-banner" role="alert">
          <strong>Problem:</strong>
          <ul>
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="warning-banner" role="status">
          <strong>Warning:</strong>
          <ul>
            {warnings.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="main">
        <Sidebar showPins={!active || !autoPins} />
        <div className="center">
          <ChipBanner chip={active} manualCmpName={cmpName} />
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
          {run && <ResultsTable run={run} selected={selectedRow} onSelect={setSelectedRow} />}
        </div>
        {showExpected && expectedTable && <ExpectedPanel table={expectedTable} />}
      </div>
    </div>
  )
}
