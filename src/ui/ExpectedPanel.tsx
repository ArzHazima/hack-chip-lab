import type { CmpFile } from '../engine/cmp'

// Read-only view of the loaded .cmp: the truth table the circuit has to match.
export default function ExpectedPanel({ cmp, fileName }: { cmp: CmpFile; fileName: string }) {
  const bin = (v: number, width: number) => v.toString(2).padStart(width, '0')
  return (
    <aside className="expected">
      <h3>
        Expected — {fileName} <span className="muted">({cmp.rows.length} rows)</span>
      </h3>
      <div className="expected-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {cmp.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cmp.rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {r.values.map((v, j) => (
                  <td key={j} className="mono">
                    {bin(v, cmp.widths[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  )
}
