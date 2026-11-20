// Parser for Nand2Tetris .cmp files:
//   |  a  |  b  | out |
//   |  0  |  1  |  1  |
// Values are binary strings; a column's width is the length of its (trimmed) value.

export interface CmpRow {
  values: number[] // aligned with CmpFile.columns
}

export interface CmpFile {
  columns: string[]
  widths: number[] // bit width per column, taken from the first data row
  rows: CmpRow[]
}

export class CmpParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CmpParseError'
  }
}

/** Split `| a | b |` into ['a','b'] (trimmed, outer bars removed). */
function splitRow(line: string): string[] {
  const t = line.trim()
  if (!t.startsWith('|') || !t.endsWith('|')) {
    throw new CmpParseError(`Row must start and end with "|": ${line}`)
  }
  return t
    .slice(1, -1)
    .split('|')
    .map((s) => s.trim())
}

export function parseCmp(text: string): CmpFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new CmpParseError('Empty .cmp file')

  const columns = splitRow(lines[0])
  if (columns.some((c) => c === '')) throw new CmpParseError('Header has an empty column name')
  if (new Set(columns).size !== columns.length) {
    throw new CmpParseError('Header has duplicate column names')
  }

  const widths: number[] = []
  const rows: CmpRow[] = []
  lines.slice(1).forEach((line, r) => {
    const cells = splitRow(line)
    const rowNo = r + 1
    if (cells.length !== columns.length) {
      throw new CmpParseError(`Row ${rowNo}: expected ${columns.length} values, found ${cells.length}`)
    }
    const values = cells.map((cell, i) => {
      if (!/^[01]+$/.test(cell)) {
        throw new CmpParseError(`Row ${rowNo}, column "${columns[i]}": "${cell}" is not a binary value`)
      }
      if (rowNo === 1) widths[i] = cell.length
      else if (cell.length !== widths[i]) {
        throw new CmpParseError(
          `Row ${rowNo}, column "${columns[i]}": width ${cell.length}, expected ${widths[i]}`,
        )
      }
      return parseInt(cell, 2)
    })
    rows.push({ values })
  })
  if (rows.length === 0) throw new CmpParseError('.cmp file has a header but no data rows')
  return { columns, widths, rows }
}
