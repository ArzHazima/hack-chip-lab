import { useEffect } from 'react'

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Load a folder',
    text: 'Click “Load folder” and choose a folder that holds your exercises: for every chip a Name.hdl, a Name.tst and a Name.cmp file. You can also drop the folder on the page. No files at hand? Click “Load example chips” to try the app with ready-made ones.',
  },
  {
    title: 'Pick a chip',
    text: 'Choose a chip from the big name at the top (or from “From your folder” on the left). Its input and output pins appear on the board by themselves.',
  },
  {
    title: 'Wire the pins',
    text: 'Drag gates from the left onto the board. Then drag from a small circle on the right side of one item to a circle on the left side of another to make a wire. Click a wire or a gate and press Delete to remove it.',
  },
  {
    title: 'Use only some bits',
    text: 'To wire part of a wide pin, click its name (for example in[16]) to open its bit strip, drag across the bits you want, and wire from the new handle, such as [4..7]. “Split to bits” makes one handle per bit.',
  },
  {
    title: 'Set the inputs',
    text: 'On an input pin, click the bit buttons (1 or 0) or type a decimal number. Use Tick, Tock or Step for chips with memory.',
  },
  {
    title: 'Press Run',
    text: 'The test results appear at the bottom: ✅ passed, ❌ failed. Click a row to see that row’s values on the board.',
  },
]

/** The "How to use" dialog. Closes with the button, a click outside, or the Escape key. */
export default function HelpPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="help-title">How to use Hack Chip Lab</h2>
        <ol>
          {STEPS.map((s) => (
            <li key={s.title}>
              <b>{s.title}.</b> {s.text}
            </li>
          ))}
        </ol>
        <p className="help-tip">
          No folder? You can still build freely: add pins from “Pins” on the left, then use “Upload .cmp” (and
          optionally “Upload .tst”) in the toolbar. The Help button at the top right opens this panel again.
        </p>
        <button className="primary" onClick={onClose} autoFocus>
          Got it
        </button>
      </div>
    </div>
  )
}
