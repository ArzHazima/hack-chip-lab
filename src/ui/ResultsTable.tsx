import type { TestRun } from '../engine/runTests'

interface Props {
  run: TestRun
  widths: Record<string, number> // column name -> bit width, for binary formatting
  selected: number | null
  onSelect: (index: number) => void
}

export default function ResultsTable({ run, widths, selected, onSelect }: Props) {
  // Show values in binary, padded to the column width, like the .cmp file does.
  const fmt = (vals: Record<string, number>) =>
    Object.entries(vals)
      .map(([k, v]) => `${k}=${v.toString(2).padStart(widths[k] ?? 1, '0')}`)
      .join('  ')

  return (
    <section className="results">
      <div className="results-summary">
        {run.passed === run.total ? '✅' : '❌'} {run.passed} / {run.total} rows passed
        <span className="muted"> — click a row to show its values on the board</span>
      </div>
      <div className="results-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Inputs</th>
              <th>Expected</th>
              <th>Actual</th>
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
                <td className="mono">{fmt(r.inputs)}</td>
                <td className="mono">{fmt(r.expected)}</td>
                <td className="mono">{fmt(r.actual)}</td>
                <td>{r.pass ? '✅' : '❌'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
