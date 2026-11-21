import { useRef, type ChangeEvent } from 'react'

interface Props {
  cmpName: string | null
  showExpected: boolean
  clockTime: string // "0", "0+", "1", ... (see Simulator.time)
  onUpload: (file: File) => void
  onRun: () => void
  onToggleExpected: () => void
  onTick: () => void
  onTock: () => void
  onStep: () => void
  onReset: () => void
  hasSelection: boolean
  onDeleteSelected: () => void
}

export default function TopBar(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) p.onUpload(file)
    e.target.value = '' // allow re-uploading the same file after editing it
  }

  return (
    <header className="topbar">
      <strong className="brand">Hack Chip Lab</strong>
      <input ref={fileRef} type="file" accept=".cmp,text/plain" hidden onChange={onChange} />
      <button onClick={() => fileRef.current?.click()}>Upload .cmp</button>
      <span className="file-name">{p.cmpName ?? 'no file loaded'}</span>
      <button disabled={!p.cmpName} aria-pressed={p.showExpected} onClick={p.onToggleExpected}>
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
