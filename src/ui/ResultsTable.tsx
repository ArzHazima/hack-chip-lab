import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RunView } from './types'

interface Props {
  run: RunView
  selected: number | null
  busy?: boolean // a clicked row is being replayed ("computing...")
  onSelect: (index: number) => void
  onClose: () => void
}

// Long scripts give tens of thousands of rows. Above this many rows only the rows near the visible part are put in
// the page (a spacer row above and below keeps the scrollbar honest). Every row has the same fixed height
// (--result-row-h in index.css), which is what makes the arithmetic possible.
const VIRTUAL_FROM = 300
const OVERSCAN = 20
// ONE constant for the row height: it is written into the page as the CSS variable --result-row-h (inline on the
// table's section, so the stylesheet default is only a fallback) and used for the scroll arithmetic. On top of that
// a layout effect MEASURES a real row, so a different browser zoom, font or border still gives the right rows.
export const ROW_H = 28

/**
 * Which rows to put in the page: the visible ones plus OVERSCAN on each side, CLAMPED to the rows that exist. A stale
 * scroll position (the row height was just corrected, or a shorter run replaced a longer one) must never give an empty
 * window: with no row on screen nothing could be measured or scrolled to repair it, and the spacer would keep the
 * stale scroll height alive.
 */
export function windowRange(top: number, height: number, rowH: number, count: number): { first: number; last: number } {
  const visibleRows = Math.ceil(height / rowH)
  const first = Math.max(0, Math.min(Math.floor(top / rowH) - OVERSCAN, count - visibleRows - 2 * OVERSCAN))
  return { first, last: Math.min(count, first + visibleRows + 2 * OVERSCAN + 1) }
}

export default function ResultsTable({ run, selected, busy, onSelect, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0) // scrollTop of the scroll box
  const [height, setHeight] = useState(300) // its visible height
  const [rowH, setRowH] = useState(ROW_H) // the real height of a row, measured below
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

  // Measure a real row (not a spacer) after every render that changes the window; adopt the measured height if it differs.
  useLayoutEffect(() => {
    if (!virtual) return
    const row = scrollRef.current?.querySelector<HTMLElement>('tbody tr[data-row]')
    const h = row?.getBoundingClientRect().height
    if (h && h > 4 && Math.abs(h - rowH) > 0.01) {
      setRowH(h)
      if (scrollRef.current) setTop(scrollRef.current.scrollTop)
    }
  })

  let first = 0
  let last = run.rows.length
  if (virtual) {
    ;({ first, last } = windowRange(top, height, rowH, run.rows.length))
  }
  const shown = run.rows.slice(first, last)
  const colSpan = run.headers.length + 2

  return (
    <section className="results" style={{ ['--result-row-h' as string]: `${ROW_H}px` }}>
      <button type="button" className="results-close" onClick={onClose} aria-label="Close test results" title="Close test results (the circuit is not changed)">
        ×
      </button>
      <div className="results-summary">
        <span className="results-title">
          {run.ok ? '✅' : '❌'} Test results: {run.passed} / {run.total} passed
        </span>
        <span className="muted"> — click a row to show its values on the board</span>
        {busy && (
          <span className="results-busy" role="status">
            {' '}
            ⏳ computing…
          </span>
        )}
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
                <td colSpan={colSpan} style={{ height: first * rowH }} />
              </tr>
            )}
            {shown.map((r) => (
              <tr
                key={r.index}
                className={`${r.pass ? 'pass' : 'fail'} ${selected === r.index ? 'selected' : ''}`}
                data-row={r.index}
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
                <td colSpan={colSpan} style={{ height: (run.rows.length - last) * rowH }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
