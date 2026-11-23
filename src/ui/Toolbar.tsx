import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { FORMAT_MODES, type FormatMode } from './formatValue'

/**
 * A button that can explain WHY it is disabled: `whyNot` is the reason (null = enabled), shown
 * as a tooltip on the button and its wrapper (some browsers do not show tooltips on disabled buttons).
 */
function Btn(props: { whyNot: string | null; title: string; onClick: () => void; children: ReactNode; primary?: boolean }) {
  const tip = props.whyNot ? `Not available: ${props.whyNot}` : props.title
  return (
    <span className="btn-wrap" title={tip}>
      <button
        type="button"
        className={props.primary ? 'primary' : undefined}
        disabled={props.whyNot !== null}
        title={tip}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </span>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tool-group" role="group" aria-label={label}>
      <div className="tool-label">{label}</div>
      <div className="tool-buttons">{children}</div>
    </div>
  )
}

interface Props {
  // Files
  onLoadFiles: (files: File[]) => void
  uploadWhyNot: string | null // why Upload .cmp / .tst are unavailable (a chip is selected), or null
  onUploadCmp: (file: File) => void
  onUploadTst: (file: File) => void
  // Run
  runWhyNot: string | null
  onRun: () => void
  clockWhyNot: string | null // why Tick / Tock / Step are unavailable (empty board), or null
  resetWhyNot: string | null
  clockTime: string // "0", "0+", "1", ... (see Simulator.time)
  onTick: () => void
  onTock: () => void
  onStep: () => void
  onReset: () => void
  // View
  expectedWhyNot: string | null
  showExpected: boolean
  onToggleExpected: () => void
  format: FormatMode
  onFormat: (m: FormatMode) => void
  deleteWhyNot: string | null
  onDeleteSelected: () => void
}

/** The toolbar under the top bar: three labelled groups (Files, Run, View). */
export default function Toolbar(p: Props) {
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const cmpRef = useRef<HTMLInputElement>(null)
  const tstRef = useRef<HTMLInputElement>(null)

  /** Hands the picked files to `cb`, then clears the input so the same file can be picked again. */
  const picked = (cb: (files: File[]) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) cb(files)
    e.target.value = ''
  }

  return (
    <div className="toolbar">
      {/* Hidden file inputs. webkitdirectory (pick a whole folder) is not in React's types, hence the spread. */}
      <input ref={folderRef} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={picked(p.onLoadFiles)} />
      <input ref={filesRef} type="file" multiple hidden accept=".hdl,.tst,.cmp" onChange={picked(p.onLoadFiles)} />
      <input ref={cmpRef} type="file" hidden accept=".cmp,text/plain" onChange={picked(([f]) => p.onUploadCmp(f))} />
      <input ref={tstRef} type="file" hidden accept=".tst,text/plain" onChange={picked(([f]) => p.onUploadTst(f))} />

      <Group label="Files">
        <Btn whyNot={null} title="Pick a folder with Name.hdl / Name.tst / Name.cmp files (you can also drop it on the page)" onClick={() => folderRef.current?.click()}>
          Load folder
        </Btn>
        <Btn whyNot={null} title="Pick several .hdl / .tst / .cmp files" onClick={() => filesRef.current?.click()}>
          Load files
        </Btn>
        <Btn whyNot={p.uploadWhyNot} title="Upload a .cmp file with the expected results (free board only)" onClick={() => cmpRef.current?.click()}>
          Upload .cmp
        </Btn>
        <Btn whyNot={p.uploadWhyNot} title="Upload a .tst test script (free board only)" onClick={() => tstRef.current?.click()}>
          Upload .tst
        </Btn>
      </Group>

      <Group label="Run">
        <Btn primary whyNot={p.runWhyNot} title="Run the test script and compare with the .cmp" onClick={p.onRun}>
          ▶ Run
        </Btn>
        <Btn whyNot={p.clockWhyNot} title="Tick: the clock goes up, chips remember their inputs" onClick={p.onTick}>
          Tick
        </Btn>
        <Btn whyNot={p.clockWhyNot} title="Tock: the clock goes down, remembered values appear on the outputs" onClick={p.onTock}>
          Tock
        </Btn>
        <Btn whyNot={p.clockWhyNot} title="Step: one full clock cycle (Tick then Tock)" onClick={p.onStep}>
          Step
        </Btn>
        <Btn whyNot={p.resetWhyNot} title="Reset: forget all stored values and set the clock back to 0" onClick={p.onReset}>
          Reset
        </Btn>
        <span className="clock" title="Clock: 1+ means after Tick, 2 means after Tock">
          Clock <b>{p.clockTime}</b>
        </span>
      </Group>

      <Group label="View">
        <Btn whyNot={p.expectedWhyNot} title={p.showExpected ? 'Hide the expected table' : 'Show the expected table from the .cmp file'} onClick={p.onToggleExpected}>
          {p.showExpected ? 'Hide expected' : 'Show expected'}
        </Btn>
        <div className="segmented" role="radiogroup" aria-label="Number format">
          {FORMAT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={p.format === m.id}
              className={p.format === m.id ? 'seg on' : 'seg'}
              title={m.title}
              onClick={() => p.onFormat(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Btn whyNot={p.deleteWhyNot} title="Delete the selected chips, pins and wires (or press Delete / Backspace)" onClick={p.onDeleteSelected}>
          Delete selected
        </Btn>
      </Group>
    </div>
  )
}
