// VERIFICATION ONLY: runs the official course scripts for Project 5 (examples/project5, git-ignored, never committed)
// against the BUILT-IN chips. The whole file is skipped when the folder is not on this machine, so CI and fresh
// clones are unaffected. Nothing from those files is copied into the repository.
import { describe, expect, it } from 'vitest'
import { CHIPS } from '../src/engine/chips'
import { addChip, addPin, connect, emptyCircuit, type Circuit } from '../src/engine/circuit'
import { runExercise } from '../src/engine/exercise'
import { parseHack } from '../src/engine/hack'

const files = import.meta.glob('../examples/project5/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const file = (name: string): string => files[`../examples/project5/${name}`]
const present = Object.keys(files).length > 0

/** One built-in chip with every pin wired to a circuit pin of the same name. */
function single(type: string, extra: { key?: number } = {}): Circuit {
  const def = CHIPS[type]
  let c = emptyCircuit()
  c = addChip(c, 'u', type)
  c.chips[0] = { ...c.chips[0], ...extra }
  for (const p of def.inputs) {
    c = addPin(c, p.name, p.name, 'input', p.width)
    c = connect(c, { pin: p.name }, { chip: 'u', pin: p.name })
  }
  for (const p of def.outputs) {
    c = addPin(c, `o_${p.name}`, p.name, 'output', p.width)
    c = connect(c, { chip: 'u', pin: p.name }, { pin: `o_${p.name}` })
  }
  return c
}

const programs = () =>
  new Map(
    ['Add', 'Max', 'Rect'].filter((n) => file(`${n}.hack`)).map((n) => [`${n}.hack`, parseHack(file(`${n}.hack`)).words] as const),
  )

// [script, chip, key held at the start]
// [script, chip, key held at the start, rows that must pass]
// Memory.tst waits twice for a key (K = 75, then Y = 89). With no key the first wait stops the script (44 rows
// before it); with the Keyboard key box at 75 the first wait ends and the second one stops it.
const CASES: [string, string, number | undefined, number][] = [
  ['CPU', 'CPU', undefined, 92],
  ['CPU-external', 'CPU', undefined, 92],
  ['Memory', 'Memory', undefined, 44],
  ['Memory', 'Memory', 75, 66], // the 67th row needs the second key (Y = 89), which one key box cannot give
  ['ComputerAdd', 'Computer', undefined, 14],
  ['ComputerMax', 'Computer', undefined, 27],
  ['ComputerRect', 'Computer', undefined, 64],
]

describe.skipIf(!present)('official Project 5 scripts against the built-in chips', () => {
  for (const [script, chip, key, mustPass] of CASES) {
    it(`${script}.tst vs ${script}.cmp on the built-in ${chip}${key ? ` (key ${key})` : ''}`, () => {
      const r = runExercise(single(chip, { key }), file(`${script}.tst`), file(`${script}.cmp`), { programs: programs() })
      const firstBad = r.rows.find((x) => !x.pass)
      // eslint-disable-next-line no-console
      console.log(
        `OFFICIAL ${script}: ${r.passed}/${r.total} rows pass` +
          (firstBad ? ` | first differing row #${firstBad.index + 1}: expected [${firstBad.expected}] actual [${firstBad.actual}]` : '') +
          (r.message ? ` | ${r.message}` : '') +
          (r.warnings.length ? ` | warnings: ${r.warnings.join(' / ')}` : '') +
          (r.info.length ? ` | info: ${r.info.join(' / ')}` : ''),
      )
      expect(r.total).toBeGreaterThan(0)
      if (mustPass > 0) expect(r.passed).toBeGreaterThanOrEqual(mustPass)
    })
  }
})
