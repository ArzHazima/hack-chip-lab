import type { ExerciseChip, ExerciseFile } from '../engine/exercise'

interface Props {
  chips: ExerciseChip[]
  active: ExerciseChip | null
  onSelectChip: (name: string | null) => void
  // Free-board mode (no chip selected): the files uploaded by hand.
  manualCmpName: string | null
  manualTstName: string | null
  onHelp: () => void
}

const chipLabel = (c: ExerciseChip) => (c.missing.length ? `⚠ ${c.name} (missing ${c.missing.join(', ')})` : c.name)

/**
 * Top bar: app name on the left, the SELECTED CHIP in the middle (large, with its file names
 * under it) and the Help button on the right.
 */
export default function TopBar({ chips, active, onSelectChip, manualCmpName, manualTstName, onHelp }: Props) {
  const file = (label: string, f: ExerciseFile | undefined, ext: string) =>
    f ? (
      <span key={label}>
        {label} <b>{f.name}</b>
      </span>
    ) : (
      <span key={label} className="missing" title={`${active?.name}.${ext} was not found in the loaded files`}>
        {label} ⚠ {active?.name}.{ext} missing
      </span>
    )

  return (
    <header className="topbar">
      <div className="brand">Hack Chip Lab</div>

      <div className="chip-title">
        {chips.length > 0 ? (
          <select
            className="chip-title-select"
            value={active?.name ?? ''}
            onChange={(e) => onSelectChip(e.target.value || null)}
            aria-label="Selected chip"
            title="Choose which chip you are building"
          >
            <option value="">— no chip selected —</option>
            {chips.map((c) => (
              <option key={c.name} value={c.name}>
                {chipLabel(c)}
              </option>
            ))}
          </select>
        ) : (
          <div className="chip-title-text" title="Load a folder to get a list of chips">
            No chip selected
          </div>
        )}
        <div className="chip-files">
          {active ? (
            <>
              {file('CMP', active.cmp, 'cmp')} · {file('TST', active.tst, 'tst')} · {file('HDL', active.hdl, 'hdl')}
            </>
          ) : chips.length > 0 ? (
            <span>
              Free board · CMP <b>{manualCmpName ?? 'none'}</b> · TST <b>{manualTstName ?? 'none'}</b>
            </span>
          ) : (
            <span>Click “Load folder” to start, or press Help</span>
          )}
        </div>
      </div>

      <button className="help-btn" onClick={onHelp} title="How to use this app (5 steps)">
        ? Help
      </button>
    </header>
  )
}
