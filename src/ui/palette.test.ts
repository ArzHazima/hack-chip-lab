import { describe, expect, it } from 'vitest'
import { CHIP_GROUPS } from '../engine/chips'
import { visibleChipGroups } from './palette'

const names = (groups: { chips: string[] }[]) => groups.flatMap((g) => g.chips)

describe('the chip under test is not offered as a block in its own palette', () => {
  it('hides the built-in with the same name as the selected chip (e.g. RAM8 or Bit)', () => {
    for (const hidden of ['RAM8', 'Bit', 'Register', 'Nand', 'ALU']) {
      const shown = names(visibleChipGroups(CHIP_GROUPS, hidden))
      expect(shown, hidden).not.toContain(hidden)
      // every OTHER built-in is still there
      expect(shown.length, hidden).toBe(names(CHIP_GROUPS).length - 1)
    }
  })

  it('keeps the groups and the order of the other chips', () => {
    const groups = visibleChipGroups(CHIP_GROUPS, 'RAM8')
    expect(groups.map((g) => g.title)).toEqual(CHIP_GROUPS.map((g) => g.title))
    const memory = groups.find((g) => g.title.includes('Memory'))!
    const original = CHIP_GROUPS.find((g) => g.title.includes('Memory'))!
    expect(memory.chips).toEqual(original.chips.filter((n) => n !== 'RAM8'))
  })

  it('shows everything when no chip is selected, or the chip is not a built-in', () => {
    expect(visibleChipGroups(CHIP_GROUPS, null)).toEqual(CHIP_GROUPS)
    expect(visibleChipGroups(CHIP_GROUPS, 'CompactALU')).toEqual(CHIP_GROUPS)
    expect(visibleChipGroups(CHIP_GROUPS, 'ram8')).toEqual(CHIP_GROUPS) // names are case-sensitive, like HDL
  })

  it('drops a group that would become empty and does not change the original list', () => {
    const tiny = [{ title: 'A', chips: ['X'] }, { title: 'B', chips: ['Y', 'Z'] }]
    expect(visibleChipGroups(tiny, 'X')).toEqual([{ title: 'B', chips: ['Y', 'Z'] }])
    expect(tiny[0].chips).toEqual(['X'])
  })
})
