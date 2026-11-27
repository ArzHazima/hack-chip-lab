# Changelog

## Unreleased

### Pre-v1.0 fixes, part 1: engine robustness
- **H1:** `.tst` warnings and `echo` info lines are de-duplicated with a Set and capped (50 + "... and N more"). 60,000 distinct
  unknown commands parsed in 68-72 s before, now 67 ms; 60,000 distinct `echo` lines 8-10 s, now 121 ms.
- **H2:** an output-list column must have `left + len + right <= 64`, an output-list at most 200 columns, all output at most
  50 million characters (and still 100,000 rows); a limit stops the script with a message and keeps the rows so far.
- **M3:** a run-time error in the middle of a script (unknown pin, `Type[99999]`, script too long ...) returns the rows
  produced so far plus a "stopped" message instead of throwing them away. An error before the first row is thrown as before.
- **M5:** the ignored `load` / `output-file` / `compare-to` lines are grey info lines, not yellow warnings.
- **M4:** documented (CLAUDE.md) and pinned by a test: a register's `peek` is the value latched at the tick, a memory word
  changes only at the tock. No behaviour change.
- **L1/L2:** `tests/memory.test.ts` uses 30,000 rows and counts bytes by walking the result (13.5 s before, no GC flag);
  `perf.test.ts` thresholds are looser for slow CI machines.
- **L3:** Node is pinned to the current LTS major (26) in `ci.yml`, `pages.yml` and `.nvmrc`.

### Project 5, stage 3: the official script format and internal state in `.tst`
- **Internal state by chip type** (`engine/stateRef.ts`): `set RAM16K[3] 5`, `set PC[] 0`, `set DRegister[] 7`,
  output columns such as `RAM16K[3]%D1.6.1`, `PC[]%D0.4.0`, `DRegister[]`, `ARegister[]` and `ARegister[0]`, `Screen[i]`,
  `Memory[i]`, `Keyboard[]`. A pin with the same name wins; a block on the board beats one inside a CPU / Computer;
  two candidates give an error that lists them; `DRegister[]` / `ARegister[]` without such a block tells the user to
  use the DRegister / ARegister block (not a generic Register). Register values read by a script are the values
  latched at the tick (the course's CPU.cmp shows D already new at time "1+"); the output pins change at tock.
- **`ROM32K load Prog.hack`** (also for Computer) takes the program from the loaded `.hack` files by name; a file that is
  not loaded is an error pointing to Load files.
- **`while pin <> value { }`** (= <> < > <= >=) with a cap of 100,000 loops per script. A cap hit stops the script with a
  message that names the step (the last `echo`) and tells the user to set the key box of the Keyboard block; the rows
  produced so far are kept and compared. `echo "..."` shows an info line in the results; `clear-echo` is accepted;
  `load X.hdl`, `output-file` and `compare-to` are ignored with a warning (never silently).
- **Official .cmp format:** a cell of stars (`*******`) accepts any value; header names (even cut to the column width,
  `addre`, `DRegiste`) are never compared, columns match by position. `set` accepts `%B` `%X` `%D` and negatives; the
  tokenizer keeps `"quoted text"` in one piece, so commas inside `echo` are harmless.
- **Memory:** result rows keep only text and a pass flag. The wire values of a clicked row are rebuilt by **replaying**
  the script up to that row (`ExerciseRun.replay`). 100,000 rows on a circuit with about 100 wires: 618.6 MB -> 10.7 MB.
  The results table shows only the visible rows when there are more than 300.
- **Speed:** the simulator caches the last evaluation, so tick and tock evaluate the circuit once each, and an `output`
  after them adds nothing (before: three evaluations per `tick, tock, output`).
- Verified against the official Project 5 course files (kept outside the repository, test skipped when absent):
  CPU, CPU-external, ComputerAdd, ComputerMax, ComputerRect pass every row; Memory passes all rows up to the first
  keyboard wait (44 / 67, 66 / 67 with the key box at 75).
- Tests: 368 -> 426 (433 on a machine that has the official files: the official-file cases only run there).

### Project 5, stage 2: native CPU and Computer
- **CPU** and **Computer** built-in chips in the "Project 5 – Computer" section, with Hack semantics: A and D
  registers, PC, ALU, all 8 jump conditions, every destination combination, `reset` on PC. Timing: tick samples the
  inputs and the current A, D, PC and computes the next ones, tock makes them current; the ALU and a jump use the OLD A.
- **Per-output dependencies in use:** CPU `addressM` and `pc` depend on no input, `outM` and `writeM` on `inM` and
  `instruction`. A Computer built on the board from ROM32K + CPU + Memory is accepted (no false cycle) and matches the
  native one cycle by cycle; a loop `outM` → address is still rejected.
- **Computer** has only a `reset` input; it takes its program from the `.hack` dropdown in the node (like ROM32K) and has a
  key box. The Reset button clears A, D, PC, RAM and Screen and keeps the program.
- **Internal state for stage 3:** `peekRegister` / `pokeRegister` (A, D, PC) and `peek` / `poke` (memory) on the
  Simulator, and `exposes` (chip type → register) on CPU and Computer. The `.tst` syntax for it is not built yet.
- **Speed:** the native Computer runs about 400,000 clock cycles per second (counting loop, Node 24, this machine);
  the same machine built from ROM32K + CPU + Memory blocks about 77,000.
- Tests: 273 → 368 (CPU: A-instruction, 28 computations, 8 destinations, 8 jumps x 3 results, reset, timing, ALU
  cross-check; five hand-traced Computer programs; cycle rules with the real chips).
- A clocked chip with no outputs now still gets a planner step (it used to be skipped).

### Project 5, stage 1: memory system (see `docs/ADR-R2-project5.md`)
- **New built-in chips** in a "Project 5 – Computer" sidebar section: **ROM32K** (program memory), **Screen**
  (8K words), **Keyboard** and **Memory** (RAM16K at 0..16383, Screen at 16384..24575, Keyboard at 24576).
  Reads are combinational, writes happen at tock; **Reset** clears RAM and Screen but keeps the loaded program
  and the key.
- **`.hack` files:** a parser (16-character 0/1 lines; blank lines and CRLF are fine; an invalid line is skipped
  with a warning that names its line number; more than 32768 instructions is an error) and `.hack` as a fourth
  accepted extension in Load folder / Load files / drag and drop. The ROM32K block has a dropdown of the loaded
  programs and shows the number of instructions; Keyboard and Memory have a key-code box.
- **Per-output dependencies in the planner** (`SeqBehavior.deps`): a clocked chip's outputs can depend on
  different inputs, so a fetch loop like ROM32K → CPU → ROM32K.address is not a false cycle, while a real
  combinational loop still is. Existing chips are unchanged.
- Saved boards now keep the chosen `.hack` file name and the key code.
- Tests: 229 → 273 (parser, every new chip, Memory address map, dependency rules, a hand-written 8-instruction
  program read through ROM32K, node data → circuit). The `stops runaway scripts` test got a 30 s timeout: it
  runs a million clock cycles and failed on a loaded machine with the default 5 s.

### Live demo on GitHub Pages
- **Website:** every push to `main` runs the tests, builds the app and publishes it with
  `.github/workflows/pages.yml` (actions pinned to full SHAs, least-privilege permissions).
  The base path comes from `VITE_BASE`, set by the workflow to `/<repo name>/`; local `npm run dev` and
  `npm run build` still use `/`.
- **Load example chips** (Files group): loads four bundled invented chips (Mirror16, Pick4of16, Wide16And,
  WriteOnceRAM8, each with .hdl/.tst/.cmp from `public/examples/`) without picking a folder. They are
  fetched as ordinary files and go through the same loader as a folder; the engine is unchanged.
- The production Content-Security-Policy was checked under a sub-path with `vite preview`: no violations.
- `.gitignore`: `examples/` now only ignores the root folder, so `public/examples/` is tracked.

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
- **Combinational and sequential chips:** feedback loops are allowed through the inputs of the clocked chips
  (DFF, DFF16, Bit, Register, ARegister, DRegister, PC, RAM8 … RAM16K: `in`, `load`, `inc`, `reset`), because those are
  only sampled at the clock tick. Only a combinational loop (gates only, or RAM out → RAM address) is rejected.
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

### Fixed before release
- **Easier wiring:** every connection handle has a larger invisible grab area (33 px wide, up to 27 px tall, instead of the
  9 px dot; the dot itself is unchanged), a hover highlight, and dropping a wire within 32 px of a handle snaps to the
  nearest one. The grab areas shrink where handles are only 22 px apart, so neighbouring handles never overlap.
- **Pins no longer overlap:** pin nodes that grow (selected test row, open bit strip or range column) push the pins below
  them down. The default gap between pins is larger.
- **The test results panel has a close button (×).**
- Feedback loops through RAM / Register / PC inputs are now allowed (for example `RAM8` out → logic → `RAM8` load, or
  `RAM8` out → `Inc16` → `RAM8` in), matching the Nand2Tetris simulator. Dependencies are now declared per input pin.

### Known limitations
- No CPU, Memory or Computer: no ROM, screen or keyboard, and `.hack` programs cannot be loaded.
- A `.tst` cannot read or set internal chip state (`RAM16K[0]`, `PC[]`).
- No reusable user-made chips; the `.hdl` implementation is never imported.
- Only a subset of the `.tst` language; only the `.hdl` interface is parsed.
- Every pin and bus is at most 16 bits wide.
- Bit ranges cannot be edited: to change one, delete it (`×`) and add a new one. Split / Join settings likewise.
- Not optimized for very large circuits or very long result tables.
- Tested only in a Chromium-based browser.
