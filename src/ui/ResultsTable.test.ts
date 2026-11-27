// The results table only puts the rows near the visible part into the page when a run is long.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ResultsTable from './ResultsTable'
import type { RunView } from './types'

const view = (n: number): RunView => ({
  ok: true,
  passed: n,
  total: n,
  headers: ['Expected', 'Actual'],
  info: ['Select the Screen view'],
  rows: Array.from({ length: n }, (_, i) => ({ index: i, pass: true, cells: [`e${i}`, `a${i}`] })),
})
const html = (n: number) =>
  renderToStaticMarkup(createElement(ResultsTable, { run: view(n), selected: null, onSelect: () => {}, onClose: () => {} }))
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

describe('ResultsTable', () => {
  it('a short run renders every row', () => {
    expect(count(html(50), /<tr class="pass/g)).toBe(50)
  })
  it('a 100,000-row run renders only a window of rows plus one spacer below', () => {
    const h = html(100_000)
    const rows = count(h, /<tr class="pass/g)
    expect(rows).toBeGreaterThan(10)
    expect(rows).toBeLessThan(100)
    expect(count(h, /results-spacer/g)).toBe(1) // scrolled to the top: nothing above, the rest below
    expect(h).toContain('e0<') // the first row is there, the last one is not
    expect(h).not.toContain('e99999<')
  })
  it('shows the echo text as an info line', () => {
    expect(html(3)).toContain('Select the Screen view')
  })
})
