import { useRef, type ChangeEvent } from 'react'
import type { ExerciseChip } from '../engine/exercise'

interface Props {
  // chip selector / folder loading
  chips: ExerciseChip[]
  activeName: string | null
  onSelectChip: (name: string | null) => void
  onLoadFiles: (files: File[]) => void
  // manual .cmp upload (only used when no chip is selected)
  cmpName: string | null
  onUpload: (file: File) => void
  canShowExpected: boolean
  showExpected: boolean
  onToggleExpected: () => void
  // clock
  clockTime: string // "0", "0+", "1", ... (see Simulator.time)
  onTick: () => void
  onTock: () => void
  onStep: () => void
  onReset: () => void
  // editing / running
  hasSelection: boolean
  onDeleteSelected: () => void
  onRun: () => void
}

export default function TopBar(p: Props) {
  const cmpRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  const picked = (cb: (files: File[]) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) cb(files)
    e.target.value = '' // allow picking the same folder/file again after editing it
  }

  const label = (c: ExerciseChip) => (c.missing.length ? `⚠ ${c.name} (missing ${c.missing.join(', ')})` : c.name)

  return (
    <header className="topbar">
      <strong className="brand">Hack Chip Lab</strong>

      {/* webkitdirectory makes the browser pick a whole folder; it is not in React's types, hence the spread. */}
      <input ref={folderRef} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={picked(p.onLoadFiles)} />
      <input ref={filesRef} type="file" multiple hidden accept=".hdl,.tst,.cmp" onChange={picked(p.onLoadFiles)} />
      <button onClick={() => folderRef.current?.click()} title="Pick a folder with Name.hdl / Name.tst / Name.cmp files (you can also drop it on the page)">
        Load folder
      </button>
      <button onClick={() => filesRef.current?.click()} title="Pick several .hdl / .tst / .cmp files">
        Files…
      </button>
      <select
        className="chip-select"
        value={p.activeName ?? ''}
        onChange={(e) => p.onSelectChip(e.target.value || null)}
        aria-label="Chip"
        disabled={p.chips.length === 0}
      >
        <option value="">{p.chips.length ? '— no chip (manual) —' : 'no chips loaded'}</option>
        {p.chips.map((c) => (
          <option key={c.name} value={c.name}>
            {label(c)}
          </option>
        ))}
      </select>

      {/* The chip flow loads its own .cmp, so manual upload is only for "no chip selected". */}
      <input ref={cmpRef} type="file" accept=".cmp,text/plain" hidden onChange={picked(([f]) => p.onUpload(f))} />
      {!p.activeName && (
        <>
          <button onClick={() => cmpRef.current?.click()}>Upload .cmp</button>
          <span className="file-name">{p.cmpName ?? 'no file loaded'}</span>
        </>
      )}
      <span className="spacer" />

      <button disabled={!p.canShowExpected} aria-pressed={p.showExpected} onClick={p.onToggleExpected}>
        {p.showExpected ? 'Hide expected' : 'Show expected'}
      </button>
      <span className="clock" title="Clock cycles: 1+ means 'after tick', 2 means 'after tock'">
        Clock <b>{p.clockTime}</b>
      </span>
      <button onClick={p.onTick} title="Rising edge: chips sample their inputs">Tick</button>
      <button onClick={p.onTock} title="Falling edge: sampled values become the outputs">Tock</button>
      <button onClick={p.onStep} title="Tick then Tock">Step</button>
      <button onClick={p.onReset} title="Clear all stored values; clock back to 0">Reset</button>
      <button disabled={!p.hasSelection} onClick={p.onDeleteSelected} title="Delete the selected chips, pins and wires (Delete / Backspace)">
        Delete selected
      </button>
      <button className="primary" onClick={p.onRun}>
        ▶ Run
      </button>
    </header>
  )
}
