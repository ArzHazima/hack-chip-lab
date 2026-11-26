# Changelog

## v0.5 — 2026-11-25

First tagged release. The repository is private.

### What works
- **Exercise folders:** load a folder (or several files, or drag and drop) of `Name.hdl` / `Name.tst` / `Name.cmp`
  and pick a chip from a dropdown. A chip with a missing file is still listed, marked with ⚠.
- **Automatic pins:** the chip's input and output pins (names and widths, up to 16 bits) are created from the
  `IN` / `OUT` lines of its `.hdl`. Only the interface is read; `PARTS` is ignored.
- **Built-in chips:** Boolean logic (Nand … DMux8Way), arithmetic (HalfAdder, FullAdder, Add16, Inc16, ALU)
  and memory (DFF, DFF16, Bit, Register, ARegister, DRegister, PC, RAM8, RAM64, RAM512, RAM4K, RAM16K),
  drawn as gate symbols or boxes and grouped by project. The built-in with the same name as the chip you are
  building is hidden from the sidebar, so a chip can never be built out of itself.
- **Buses:** Split and Join nodes (single bits and ranges, bit 0 least significant) and true / false constants,
  with validation of range widths, overlaps and undriven bits.
- **Bit ranges directly on pins:** click the name of a multi-bit pin (a pin node or a chip pin) to open its bit
  strip, then click a bit or drag across several to create a handle such as `[4..7]`; wires from or to the handle
  carry only those bits, so most circuits need no Split / Join node. Quick buttons "Split to bits", "to nibbles"
  and "to bytes" create many handles at once, and `×` removes a handle together with its wires. Errors are shown
  on the pin and in the Run error: width mismatch, overlapping bits when driving a pin, bits not driven, a whole
  pin mixed with ranges, a range outside the pin. Ranges are saved with the circuit.
- **Combinational and sequential chips:** feedback loops are allowed through the registered chips (DFF, DFF16,
  Bit, Register, ARegister, DRegister, PC); a loop through only RAM is rejected (see limitations).
  Tick / Tock / Step / Reset with a clock counter and live stored values.
- **Values you can read:** a toolbar switch for Binary (grouped by 4 bits), Decimal, Hex or All on pins and on
  wire labels; input pins have clickable bit buttons next to the decimal box.
- **Layout:** toolbar in three labelled groups (Files, Run, View) on one row at 1280 px, disabled buttons explain
  why in their tooltip, a Help dialog that opens on the first visit, and the view refits itself when the board
  changes size unless you panned or zoomed by hand. Without a chip you can upload a `.cmp` and a `.tst` by hand.
- **Running tests:** a chip's `.tst` (`set`, `eval`, `tick`, `tock`, `ticktock`, `output`, `output-list`,
  `repeat`, comments; `%B` / `%D` / `%X` formats) is compared with its `.cmp`. Warnings are shown for unknown
  commands, values that do not fit a pin, and `%B` / `%X` columns that cut off digits.
- **Results table:** ✅ / ❌ per row with the total; clicking a row shows its values on the board.
- **Expected output:** a "Show expected" panel with the `.cmp` table.
- **Editing:** click to select, Delete / Backspace or the "Delete selected" button removes chips, pins and
  wires (a deleted node takes its wires with it).
- **Autosave:** each chip keeps its own circuit in local storage, keyed by chip name and interface so a
  same-named chip from a different exercise folder never restores a foreign circuit.
- **Project setup:** MIT license, GitHub Actions CI (type check, tests, build) and a test suite of 195 tests.

### Security & robustness
- Adversarial inputs are bounded: `.tst` loops (empty bodies and nested repeats included, 5,000,000 iterations,
  100 levels of nesting, 100,000 output rows), `.hdl` and `.tst` parsing is linear, files over 5 MB and more than
  2,000 files are skipped with a visible warning, saved circuits are validated on load (an error screen with
  "Clear saved circuit" catches the rest), and the production build ships a strict Content-Security-Policy.

### Known limitations
- No CPU, Memory or Computer: no ROM, screen or keyboard, and `.hack` programs cannot be loaded.
- A `.tst` cannot read or set internal chip state (`RAM16K[0]`, `PC[]`).
- No reusable user-made chips; the `.hdl` implementation is never imported.
- Only a subset of the `.tst` language; only the `.hdl` interface is parsed.
- Every pin and bus is at most 16 bits wide.
- Bit ranges cannot be edited: to change one, delete it (`×`) and add a new one. Split / Join settings likewise.
- A feedback loop through only a RAM chip (for example `RAM8` out → `Inc16` → `RAM8` in) is rejected as a cycle,
  although real hardware allows it; planned fix.
- Not optimized for very large circuits or very long result tables.
- Tested only in a Chromium-based browser.
