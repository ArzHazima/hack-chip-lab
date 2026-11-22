# Changelog

## v0.5 — 2026-11-23

First tagged release. The repository is private.

### What works
- **Exercise folders:** load a folder (or several files, or drag and drop) of `Name.hdl` / `Name.tst` / `Name.cmp`
  and pick a chip from a dropdown. A chip with a missing file is still listed, marked with ⚠.
- **Automatic pins:** the chip's input and output pins (names and widths, up to 16 bits) are created from the
  `IN` / `OUT` lines of its `.hdl`. Only the interface is read; `PARTS` is ignored.
- **Built-in chips:** Boolean logic (Nand … DMux8Way), arithmetic (HalfAdder, FullAdder, Add16, Inc16, ALU)
  and memory (DFF, DFF16, PC, RAM64, RAM512, RAM4K, RAM16K), drawn as gate symbols and grouped by project.
- **Buses:** Split and Join nodes (single bits and ranges, bit 0 least significant) and true / false constants,
  with validation of range widths, overlaps and undriven bits.
- **Combinational and basic sequential chips:** feedback loops are allowed only through a DFF or PC;
  Tick / Tock / Step / Reset with a clock counter and live stored values.
- **Running tests:** a chip's `.tst` (`set`, `eval`, `tick`, `tock`, `ticktock`, `output`, `output-list`,
  `repeat`, comments; `%B` / `%D` / `%X` formats) is compared with its `.cmp`. Warnings are shown for unknown
  commands, values that do not fit a pin, and `%B` / `%X` columns that cut off digits.
- **Results table:** ✅ / ❌ per row with the total; clicking a row shows its values on the board.
- **Expected output:** a "Show expected" panel with the `.cmp` table.
- **Editing:** click to select, Delete / Backspace or the "Delete selected" button removes chips, pins and
  wires (a deleted node takes its wires with it).
- **Autosave:** each chip keeps its own circuit in local storage, keyed by chip name and interface so a
  same-named chip from a different exercise folder never restores a foreign circuit.
- **Project setup:** MIT license, GitHub Actions CI (type check, tests, build) and a test suite of 128 tests.

### Known limitations
- No CPU, Memory or Computer: no ROM, screen or keyboard, and `.hack` programs cannot be loaded.
- A `.tst` cannot read or set internal chip state (`RAM16K[0]`, `PC[]`).
- No reusable user-made chips; the `.hdl` implementation is never imported.
- Only a subset of the `.tst` language; only the `.hdl` interface is parsed.
- Every pin and bus is at most 16 bits wide.
- Not optimized for very large circuits or very long result tables.
- Tested only in a Chromium-based browser.
