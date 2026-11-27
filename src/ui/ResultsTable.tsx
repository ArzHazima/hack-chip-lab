import { useEffect, useRef, useState } from 'react'
import type { RunView } from './types'

interface Props {
  run: RunView
  selected: number | null
  onSelect: (index: number) => void
  onClose: () => void
}

// Long scripts give tens of thousands of rows. Above this many rows only the rows near the visible part are put in
// the page (a spacer row above and below keeps the scrollbar honest). Every row has the same fixed height
// (--result-row-h in index.css), which is what makes the arithmetic possible.
const VIRTUAL_FROM = 300
const OVERSCAN = 20
const ROW_H = 28 // must match --result-row-h

export default function ResultsTable({ run, selected, onSelect, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0) // scrollTop of the scroll box
  const [height, setHeight] = useState(300) // its visible height
  const virtual = run.rows.length > VIRTUAL_FROM

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !virtual) return
    const measure = () => setHeight(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [virtual])

  let first = 0
  let last = run.rows.length
  if (virtual) {
    first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN)
    last = Math.min(run.rows.length, Math.ceil((top + height) / ROW_H) + OVERSCAN)
  }
  const shown = run.rows.slice(first, last)
  const colSpan = run.headers.length + 2

  return (
    <section className="results">
      <button type="button" className="results-close" onClick={onClose} aria-label="Close test results" title="Close test results (the circuit is not changed)">
        ×
      </button>
      <div className="results-summary">
        <span className="results-title">
          {run.ok ? '✅' : '❌'} Test results: {run.passed} / {run.total} passed
        </span>
        <span className="muted"> — click a row to show its values on the board</span>
        {run.note && <div className="muted results-note">{run.note}</div>}
        {run.info?.map((t) => (
          <div key={t} className="results-info">
            ℹ {t}
          </div>
        ))}
      </div>
      <div className="results-scroll" ref={scrollRef} onScroll={virtual ? (e) => setTop(e.currentTarget.scrollTop) : undefined}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              {run.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {virtual && first > 0 && (
              <tr className="results-spacer" aria-hidden="true">
                <td colSpan={colSpan} style={{ height: first * ROW_H }} />
              </tr>
            )}
            {shown.map((r) => (
              <tr
                key={r.index}
                className={`${r.pass ? 'pass' : 'fail'} ${selected === r.index ? 'selected' : ''}`}
                onClick={() => onSelect(r.index)}
              >
                <td>{r.index + 1}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className="mono">
                    {c}
                  </td>
                ))}
                <td>{r.pass ? '✅' : '❌'}</td>
              </tr>
            ))}
            {virtual && last < run.rows.length && (
              <tr className="results-spacer" aria-hidden="true">
                <td colSpan={colSpan} style={{ height: (run.rows.length - last) * ROW_H }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
