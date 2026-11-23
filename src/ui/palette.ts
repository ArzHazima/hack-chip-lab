// Which built-in chips the sidebar offers.

export interface ChipGroup {
  title: string
  chips: string[]
}

/**
 * The palette groups without the built-in that has the same name as the chip UNDER TEST.
 * Example: an exercise folder contains RAM8 and you select it. You are building RAM8, so the
 * built-in RAM8 must not be offered as a block (you could "build" it out of itself).
 * Names are case-sensitive, like HDL chip names. Groups that become empty are dropped;
 * the input is not modified.
 */
export function visibleChipGroups(groups: ChipGroup[], chipUnderTest: string | null): ChipGroup[] {
  if (!chipUnderTest) return groups
  return groups
    .map((g) => ({ ...g, chips: g.chips.filter((name) => name !== chipUnderTest) }))
    .filter((g) => g.chips.length > 0)
}
