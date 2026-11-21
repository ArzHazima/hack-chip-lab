// Read-only view of the loaded .cmp: the table the circuit has to match.
// Cells are plain text, so this works for combinational and sequential .cmp files alike.

export interface ExpectedTable {
  title: string // file name
  columns: string[]
  rows: string[][]
}

export default function ExpectedPanel({ table }: { table: ExpectedTable }) {
  return (
    <aside className="expected">
      <h3>
        Expected — {table.title} <span className="muted">({table.rows.length} rows)</span>
      </h3>
      <div className="expected-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {table.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {r.map((v, j) => (
                  <td key={j} className="mono">
                    {v}
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
