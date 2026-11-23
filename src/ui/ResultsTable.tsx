import type { RunView } from './types'

interface Props {
  run: RunView
  selected: number | null
  onSelect: (index: number) => void
}

export default function ResultsTable({ run, selected, onSelect }: Props) {
  return (
    <section className="results">
      <div className="results-summary">
        <span className="results-title">
          {run.ok ? '✅' : '❌'} Test results: {run.passed} / {run.total} passed
        </span>
        <span className="muted"> — click a row to show its values on the board</span>
        {run.note && <div className="muted results-note">{run.note}</div>}
      </div>
      <div className="results-scroll">
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
            {run.rows.map((r) => (
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
          </tbody>
        </table>
      </div>
    </section>
  )
}
