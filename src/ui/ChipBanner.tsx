import type { ExerciseChip, ExerciseFile } from '../engine/exercise'

// Always visible above the board: which chip is active and which of its files are loaded.
export default function ChipBanner({ chip, manualCmpName }: { chip: ExerciseChip | null; manualCmpName: string | null }) {
  if (!chip) {
    return (
      <div className="chip-banner">
        No chip selected — manual mode{manualCmpName ? ` · CMP: ${manualCmpName}` : ''}
      </div>
    )
  }
  const file = (label: string, f: ExerciseFile | undefined, ext: string) =>
    f ? (
      <span>
        {label}: {f.name}
      </span>
    ) : (
      <span className="missing" title={`${chip.name}.${ext} was not found in the loaded files`}>
        {label}: ⚠ {chip.name}.{ext} missing
      </span>
    )
  return (
    <div className="chip-banner">
      <span>
        Chip: <b>{chip.name}</b>
      </span>
      {' · '}
      {file('CMP', chip.cmp, 'cmp')}
      {' · '}
      {file('TST', chip.tst, 'tst')}
      {' · '}
      {file('HDL', chip.hdl, 'hdl')}
    </div>
  )
}
