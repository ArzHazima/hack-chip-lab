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
import ExpectedPanel, { type ExpectedTable } from './ui/ExpectedPanel'
import ResultsTable from './ui/ResultsTable'
import Sidebar from './ui/Sidebar'
import TopBar from './ui/TopBar'
import Toolbar from './ui/Toolbar'
import HelpPanel from './ui/HelpPanel'
import { FORMAT_MODES, valueText, type FormatMode } from './ui/formatValue'
import { maxIdNumber, pinsFromInterface, reconcilePins } from './ui/exercisePins'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { filesFromDrop, hasFiles, readExerciseFiles } from './ui/fileLoading'
import { edgeWidth, flowToCircuit, inputValues } from './ui/flowToCircuit'
import { addRanges as addRangesTo, compileRanges, rangeHandleId, removeRange as removeRangeFrom, type BitRange } from './ui/ranges'
import { fromExercise, fromTestRun } from './ui/runView'
import { chipSlot, getPref, loadCircuit, MANUAL_SLOT, saveCircuit, setPref, type SavedCircuit } from './ui/storage'
import type { AppNode, DragItem, PinIssue, PinRange, RunView } from './ui/types'
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
  // Where the board on screen is saved: MANUAL_SLOT, or "<chip name>#<interface fingerprint>".
  const [activeSlot, setActiveSlot] = useState(MANUAL_SLOT)
  const active = useMemo(() => exercises.find((c) => c.name === activeName) ?? null, [exercises, activeName])
  // Every slot's circuit lives here while the page is open (and in localStorage across visits).
  const memory = useRef(new Map<string, SavedCircuit>())

  // Free board (no chip selected): files uploaded by hand. `parsed` is the .cmp as a plain binary table;
  // it is null for a clocked .cmp (time column), which only works together with an uploaded .tst.
  const [manualCmp, setManualCmp] = useState<{ name: string; text: string; parsed: CmpFile | null; parseError: string | null } | null>(null)
  const [manualTst, setManualTst] = useState<{ name: string; text: string } | null>(null)

  // Number format of pin values and wire labels (toolbar switch), remembered between visits.
  const [format, setFormat] = useState<FormatMode>(() => {
    const saved = getPref('format')
    return FORMAT_MODES.some((m) => m.id === saved) ? (saved as FormatMode) : 'all'
  })
  const changeFormat = (m: FormatMode) => {
    setFormat(m)
    setPref('format', m)
  }
  // "How to use" panel: opens by itself on the first visit only.
  const [helpOpen, setHelpOpen] = useState(() => getPref('helpSeen') !== '1')
  const closeHelp = useCallback(() => {
    setHelpOpen(false)
    setPref('helpSeen', '1')
  }, [])

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
  // ---- bit ranges on pins (range handles; see ui/ranges.ts) ----
  const rangesOf = (n: AppNode) => (n.data as { ranges?: PinRange[] }).ranges ?? []
  const addRanges = useCallback(
    (nodeId: string, pin: string, wanted: BitRange[], width: number) =>
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== nodeId) return n
          const current = rangesOf(n)
          const next = addRangesTo(current, pin, wanted, width)
          return next.length === current.length ? n : ({ ...n, data: { ...n.data, ranges: next } } as AppNode)
        }),
      ),
    [setNodes],
  )
  const removeRange = useCallback(
    (nodeId: string, range: PinRange) => {
      const handle = rangeHandleId(range)
      setNodes((ns) =>
        ns.map((n) => (n.id === nodeId ? ({ ...n, data: { ...n.data, ranges: removeRangeFrom(rangesOf(n), range) } } as AppNode) : n)),
      )
      // wires attached to the removed handle would point at a handle that no longer exists
      setEdges((es) => es.filter((e) => !((e.source === nodeId && e.sourceHandle === handle) || (e.target === nodeId && e.targetHandle === handle))))
      structuralChange()
    },
    [setNodes, setEdges, structuralChange],
  )
  const boardContext = useMemo(
    () => ({ setInputValue, format, addRanges, removeRange }),
    [setInputValue, format, addRanges, removeRange],
  )

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
    const slot = activeSlot
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
  }, [nodes, edges, activeSlot])
  useEffect(() => {
    const save = () => persistRef.current()
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [])

  /** Make `target` (a chip name, or null for manual mode) the active board. */
  const switchTo = (target: string | null, list: ExerciseChip[] = exercises) => {
    persist() // keep what the user built for the chip we are leaving
    const chip = target ? (list.find((c) => c.name === target) ?? null) : null
    // The slot includes the chip's interface, so a same-named chip with other pins starts on a fresh board.
    const slot = chip ? chipSlot(chip) : MANUAL_SLOT
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
    setActiveSlot(slot)
    setAutoPins(auto)
    setErrors(problems)
    setWarnings([])
    structuralChange()
  }

  const onLoadFiles = async (files: File[]) => {
    try {
      const read = await readExerciseFiles(files)
      const list = groupExerciseFiles(read.files)
      if (list.length === 0) {
        setErrors(['No .hdl, .tst or .cmp files were found in what you picked.'])
        setWarnings(read.warnings)
        return
      }
      setExercises(list)
      setErrors([])
      setWarnings(read.warnings) // skipped files (too big / too many), if any
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

  const onUploadCmp = async (file: File) => {
    try {
      const text = await file.text()
      let parsed: CmpFile | null = null
      let parseError: string | null = null
      try {
        parsed = parseCmp(text)
      } catch (e) {
        parseError = (e as Error).message // e.g. a clocked .cmp with a "0+" time column
      }
      setManualCmp({ name: file.name, text, parsed, parseError })
      setErrors([])
      clearRun()
    } catch (e) {
      setErrors([`Could not read ${file.name}: ${(e as Error).message}`])
    }
  }

  const onUploadTst = async (file: File) => {
    try {
      setManualTst({ name: file.name, text: await file.text() })
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
      // ---- free board: a .cmp (and optionally a .tst) uploaded by hand ----
      if (!manualCmp) return setErrors(['Upload a .cmp file first (or load a folder and pick a chip).'])
      if (pinErrors.length) return setErrors(pinErrors)
      if (manualTst) {
        const result = runExercise(circuit, manualTst.text, manualCmp.text)
        setErrors([])
        setWarnings(result.warnings.map((w) => `${manualTst.name}: ${w}`))
        return setRun(fromExercise(result))
      }
      const table = manualCmp.parsed
      if (!table) {
        return setErrors([
          `Problem in the .cmp file: ${manualCmp.parseError}`,
          'A .cmp with a time column (clocked chips) needs the matching .tst: use "Upload .tst".',
        ])
      }
      if (hasSequential(circuit)) return setErrors(needsTst)
      const widths = Object.fromEntries(table.columns.map((c, i) => [c, table.widths[i]]))
      setErrors([])
      setRun(fromTestRun(runTests(circuit, table), widths))
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
  // Problems with bit ranges (width mismatch, overlapping or undriven bits), shown on the pins they are about.
  const issuesByNode = useMemo(() => {
    const byNode = new Map<string, PinIssue[]>()
    for (const i of compileRanges(nodes, edges).issues) {
      byNode.set(i.nodeId, [...(byNode.get(i.nodeId) ?? []), { pin: i.pin, message: i.message }])
    }
    return byNode
  }, [nodes, edges])
  const shownNodes = useMemo<AppNode[]>(
    () =>
      nodes.map((n) => {
        const issues = issuesByNode.get(n.id)
        if (n.type === 'chip') {
          const stored = view?.stored?.[n.id]
          if (stored === undefined && !issues) return n
          return { ...n, data: { ...n.data, ...(stored !== undefined ? { stored } : {}), ...(issues ? { issues } : {}) } }
        }
        // Input pins show a value badge only for a result row; live inputs are typed into the pin box.
        const value = n.type === 'inpin' ? view?.rowInputs?.[n.data.name] : view?.outputs[n.data.name]
        return { ...n, data: { ...n.data, value, ...(issues ? { issues } : {}) } } as AppNode
      }),
    [nodes, view, issuesByNode],
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
          // Buses (width > 1) show their value on the wire, in the format chosen in the toolbar.
          label: width > 1 ? valueText(v, width, format) : undefined,
          labelStyle: { fontWeight: 700, fill: v ? GREEN : '#555' },
        }
      }),
    [edges, nodes, view, format],
  )

  // The expected table: the active chip's .cmp (any format), or the manually uploaded one.
  const expectedTable = useMemo<ExpectedTable | null>(() => {
    try {
      if (active?.cmp) return { title: active.cmp.name, ...cmpTextTable(active.cmp.text) }
      if (!active && manualCmp) return { title: manualCmp.name, ...cmpTextTable(manualCmp.text) }
    } catch {
      /* unreadable .cmp: Run reports the details */
    }
    return null
  }, [active, manualCmp])

  // Why a toolbar button is unavailable (null = available). Shown as its tooltip.
  const uploadWhyNot = active
    ? 'a chip is selected, so its own .cmp and .tst are used. Choose "no chip selected" at the top to upload your own.'
    : null
  const runWhyNot = active
    ? active.cmp
      ? null
      : `${active.name}.cmp is missing from the loaded files.`
    : manualCmp
      ? null
      : 'load a folder and pick a chip, or upload a .cmp file first.'
  const clockWhyNot = nodes.length > 0 ? null : 'the board is empty. Add pins or gates first.'
  const resetWhyNot = live ? null : 'nothing to reset yet. Press Tick, Tock or Step first.'
  const expectedWhyNot = expectedTable ? null : 'no .cmp loaded yet. Pick a chip or upload a .cmp file.'
  const deleteWhyNot = hasSelection ? null : 'nothing is selected. Click a gate, pin or wire first.'

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
        active={active}
        onSelectChip={(name) => switchTo(name)}
        manualCmpName={manualCmp?.name ?? null}
        manualTstName={manualTst?.name ?? null}
        onHelp={() => setHelpOpen(true)}
      />
      <Toolbar
        onLoadFiles={onLoadFiles}
        uploadWhyNot={uploadWhyNot}
        onUploadCmp={onUploadCmp}
        onUploadTst={onUploadTst}
        runWhyNot={runWhyNot}
        onRun={onRun}
        clockWhyNot={clockWhyNot}
        resetWhyNot={resetWhyNot}
        clockTime={live?.time ?? '0'}
        onTick={() => onClock('tick')}
        onTock={() => onClock('tock')}
        onStep={() => onClock('step')}
        onReset={() => onClock('reset')}
        expectedWhyNot={expectedWhyNot}
        showExpected={showExpected}
        onToggleExpected={() => setShowExpected((s) => !s)}
        format={format}
        onFormat={changeFormat}
        deleteWhyNot={deleteWhyNot}
        onDeleteSelected={deleteSelected}
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
        <Sidebar chips={exercises} activeName={activeName} onSelectChip={(name) => switchTo(name)} showPins={!active || !autoPins} />
        <div className="center">
          <ErrorBoundary>
            <BoardContext.Provider value={boardContext}>
              <Board
                nodes={shownNodes}
                edges={shownEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDropItem={onDropItem}
                fitKey={activeSlot}
              />
            </BoardContext.Provider>
          </ErrorBoundary>
          {run && <ResultsTable
              run={run}
              selected={selectedRow}
              onSelect={setSelectedRow}
              onClose={() => {
                setRun(null) // only hides the results; the circuit and the loaded files stay as they are
                setSelectedRow(null)
              }}
            />}
        </div>
        {showExpected && expectedTable && <ExpectedPanel table={expectedTable} />}
      </div>
      {helpOpen && <HelpPanel onClose={closeHelp} />}
    </div>
  )
}
