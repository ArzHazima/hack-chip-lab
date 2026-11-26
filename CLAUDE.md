# Hack Chip Lab — Nand2Tetris visual simulator

Web app for wiring Nand2Tetris chips (Hack computer) on a 2D canvas and checking them against course test files.

## Product (MVP)
- Layout (top to bottom): **top bar** = app name (left), the SELECTED CHIP as a large dropdown in the center with its
  CMP / TST / HDL file names under it (⚠ for a missing file; on a free board it shows the uploaded files), and the
  **? Help** button (right). **Toolbar** with three labelled groups: **Files** (Load folder, Load files, Upload .cmp,
  Upload .tst), **Run** (▶ Run, Tick, Tock, Step, Reset, Clock counter), **View** (Show expected, Binary / Decimal /
  Hex / All switch, Delete selected). Below: left **sidebar** (collapsible sections: From your folder, Pins, Wiring,
  Project 1–3), the **board** in the middle, and the **results table** under it (title "Test results: N / M passed",
  fixed max height with its own scroll; the board keeps a minimum height of 300 px). **Show expected** adds a panel
  on the right.
- UI rules (UI1): a toolbar button that cannot be used is visibly disabled AND its tooltip says why (`Btn` in
  `Toolbar.tsx`, reasons computed in `App.tsx`). While the board is empty a hint says "Pick a chip on the left or drag
  gates here". The Help dialog (5 steps) opens by itself on the first visit only (`hacklab:pref:helpSeen`). All colours,
  font sizes and spacing are CSS variables at the top of `index.css`; no horizontal scroll at 1280 px.
- **Number format** (`ui/formatValue.ts`, toolbar switch, remembered in `hacklab:pref:format`): Binary (grouped by 4
  bits), Decimal, Hex or All (default). It applies to pin nodes AND to the value labels of wires wider than 1 bit.
  Input pins have a row of bit buttons (MSB on the left, bit index on top) that stay in sync with the decimal box.
  Output pins show their value after Run / Tick / Step. Pin widths are 1..16, so a 16-bit pin node is wide.
- **Keeping the board in view** (`Board.tsx`): the toolbar is tight enough to sit on ONE row at 1280 px (it wraps
  cleanly below that). A `ResizeObserver` on the board refits the view (`fitView`, max zoom 1.25) whenever the board
  changes size (window resize, results panel opening/closing, Show expected) and when a different chip's board is
  shown (`fitKey`), UNLESS the user panned or zoomed by hand (`onMoveStart` with a real event sets `userMoved`). The
  corner "fit view" button clears that flag, so auto-fit resumes.
- User drags chips from the palette onto the canvas, adds named input/output pins, and connects them with wires.
- Click a chip, pin or wire to select it (amber highlight). Delete / Backspace or the **Delete selected** button removes
  the selection plus any wires attached to deleted nodes. Keys are ignored while typing in a text field. Deletion is
  handled in `App.tsx` (`deleteSelected`), not by React Flow's `deleteKeyCode` (set to null).
- Built-in chips (ready-made, black boxes), grouped in the sidebar by Nand2Tetris project (collapsible sections,
  defined in `CHIP_GROUPS` in `chips.ts`):
  - Project 1 – Boolean Logic: Nand, Not, And, Or, Xor, Mux, DMux,
    Not16, And16, Or16, Mux16, Or8Way, Mux4Way16, Mux8Way16, DMux4Way, DMux8Way.
  - Project 2 – Boolean Arithmetic: HalfAdder, FullAdder, Add16, Inc16, ALU
    (ALU = official Hack ALU: inputs x, y, zx, nx, zy, ny, f, no → outputs out, zr, ng).
  - Project 3 – Memory (all clocked, same tick/tock model; sidebar section "Project 3 – Memory"): **DFF**, DFF16,
    **Bit** (in, load → out), **Register**, **ARegister**, **DRegister** (in[16], load → out[16]; the three behave
    identically), **PC**, **RAM8** (address[3]), **RAM64** (address[6]), **RAM512** (address[9]), **RAM4K**
    (address[12]), **RAM16K** (address[14]); RAMs take in[16], load, address and give out[16]. Bit / Register /
    ARegister / DRegister / DFF / DFF16 / PC are *registered* (loops through them are legal, they show a "stored"
    badge); the RAMs are not (see the engine rules). DFF16 (= 16 DFFs side by side) predates buses and is KEPT because
    the sequential tests build Register/RAM8 from it.
  - **The chip under test is never offered as a block in its own palette:** if an exercise folder contains a chip named
    like a built-in (Bit, Register, RAM8 ...) and you select it, the built-in with that name is hidden from the
    sidebar (`visibleChipGroups` in `ui/palette.ts`; names are case-sensitive) so you cannot build it out of itself.
  - **Wiring** (sidebar section, not in `CHIPS`): **Split** (N-bit in → single-bit outputs `[0]`..`[N-1]` and/or range
    outputs like `[0..7]`), **Join** (single-bit/range inputs → one N-bit out), **true / false** constants (all ones /
    zero, chosen width). Width 1..16. Split/Join have a "ranges" text box in the sidebar before dragging
    (`0..7, 8..15`, empty = every bit on its own); to change a dropped node, delete it and drop a new one. Bit 0 is the
    least significant. Pin names are the labels (`[3]`, `[0..7]`, `in`, `out`).
  - **Bit ranges directly on pins ("range handles")**, so most circuits need no Split/Join node: click the name of
    a multi-bit pin (`in[16]` on a pin node, or a pin label on a chip) to open its **bit strip**, click one bit or
    drag across several (MSB on the left) to create a handle such as `[4..7]`; quick buttons "Split to bits" /
    "to nibbles" / "to bytes" create many at once; `×` removes a handle together with its wires. A wire from/to a
    range handle carries only those bits (its label shows the value with the range's own width). Handles live in
    a column next to the node (left for pins that receive wires, right for pins that send them). Several ranges on
    a pin that is READ may overlap (like a Split); ranges that DRIVE one pin must not overlap and must cover every
    bit (like a Join). Problems are shown on the pin and in the Run error (width mismatch, overlapping bits, bits
    not driven, whole + range on one pin, range outside the pin). Ranges are saved in the node data (`data.ranges`,
    optional, so circuits saved earlier load unchanged).
    Implementation: `ui/ranges.ts` `compileRanges` rewrites the graph into the equivalent graph with ordinary
    Split/Join nodes inside `flowToCircuit`, so the simulation engine did not change. The rewritten wires keep the
    ids of the original edges, so the board colours and labels them as before. Golden tests (`ranges.test.ts`,
    `tests/ranges.test.ts`) compare range circuits with the equivalent Split/Join circuits.
- Chip symbols (SVG, geometry in `ui/chipLayout.ts`): And = D shape, Nand = D + bubble, Or = curved shield,
  Xor = Or + extra back curve, Not = triangle + bubble. Mux = trapezoid (wide left, `sel` enters from the bottom),
  DMux = mirrored trapezoid; the 4Way/8Way versions are the same but taller. 16-bit variants reuse the 1-bit
  symbol with a "16" label. Every other chip is a rounded rectangle with its name. 16-bit wires/leads are thicker.
- User uploads a `.cmp` file and clicks **Run** → every row is evaluated, results table shows ✅/❌ per row.
  Clicking a row loads its input values onto the canvas and colors wires by value (1 = green, 0 = gray).
- **Show expected** (enabled once a .cmp is loaded) toggles a side panel with the .cmp truth table.
- **Clocked simulation**: input pins on the board have a number box (the value fed to the circuit). **Tick** = chips
  sample inputs, **Tock** = sampled values become outputs (clock goes 0 → 0+ → 1 → 1+ ...), **Step** = tick+tock,
  **Reset** clears all state. Wires/pins show live values; every DFF/PC shows a "stored: N" badge. Editing the circuit
  restarts the simulation. **Run** clocks the circuit itself only through a .tst script (`tick` / `tock` /
  `ticktock`). Without a .tst (manual mode, or a chip that has no .tst) Run evaluates the .cmp as a combinational
  table and therefore refuses circuits that contain clocked chips (use Tick / Tock / Step by hand instead).
- **Exercise folders (chip selector)**: **Load folder** (`webkitdirectory`), **Files…** (multi-select) or drag & drop
  a folder/files onto the page. Files are grouped by base name into chips `{name, hdl, tst, cmp}`
  (`groupExerciseFiles`); a chip with a missing file is still listed with ⚠ and which file is missing. Loading
  replaces the previous list. Selecting a chip:
  - reads ONLY the interface of its .hdl (`parseHdlInterface`: IN/OUT names + widths; PARTS is ignored) and creates
    matching input/output pins (left/right columns). The manual Input/Output pin items are hidden while pins are
    automatic and come back when no chip is selected or the .hdl is missing/unreadable;
  - uses the chip's own .cmp/.tst (no separate upload: Upload .cmp / .tst are disabled while a chip is selected); the
    top bar always shows the chip name with its CMP / TST / HDL file names, ⚠ for missing files. On a free board
    (no chip) you can upload a .cmp and a .tst by hand; with a .tst the run goes through `runExercise`, so clocked
    .cmp files (time column) work too;
  - gives every chip its OWN circuit. Switching saves the current one (memory + localStorage key
    `hacklab:circuit:<chip name>#<interface hash>`, all in try/catch; manual mode uses `__manual__`) and restores the
    other. The hash (`interfaceHash`, from the IN/OUT names and widths, pin order ignored) means a same-named chip with
    a different interface, e.g. from another exercise folder, starts on a fresh board and never restores a foreign
    circuit (circuits saved by older versions under the plain-name key are simply no longer found). Autosave
    runs 400 ms after a change and on `pagehide`. A restored circuit is reconciled with the current .hdl
    (missing pins added, removed pins deleted with their wires, widths fixed).
- **Run** with a chip selected: runs its .tst (`runExercise`: parseTst → runTst → compareToCmp) and compares with its
  .cmp, ✅/❌ per row; clicking a row colours the board from that `output`'s snapshot. Without a .tst the .cmp is used
  as a plain combinational table. The yellow warning box lists unknown .tst commands (skipped together with any `{ }`
  block), `set` values that do not fit the pin width, and `%B`/`%X` columns that cut off digits. Without a chip, Run
  uses the manually uploaded .cmp exactly as before.
- The app is GENERIC: it must never hardcode chip or exercise names. Any folder of Name.hdl/.tst/.cmp must work.
- Later stages (do NOT build unless asked): saving a user circuit as a reusable chip, `.hdl` export, 3D view.

## Tech stack
- Vite + React + TypeScript (strict)
- `@xyflow/react` (React Flow) for the canvas — do not build a custom canvas
- Vitest for tests
- No backend. State in memory; localStorage only for autosave (wrap in try/catch).

## Structure
```
src/
  engine/      # pure TS, no React imports
    chips.ts       # built-in chip definitions (pins, widths, eval function)
    circuit.ts     # Circuit model: pins, chip instances, wires
    simulate.ts    # validation, evaluation order (planOrder), evaluate(); stateless simulate()
    sequential.ts  # Simulator: per-instance state, eval/tick/tock/step/reset, stored()
    cmp.ts         # .cmp parser (combinational tables)
    runTests.ts    # run all .cmp rows against a circuit → results (plans once, evaluate() per row)
    tst.ts         # .tst subset (set/eval/tick/tock/output/repeat/output-list) + compareToCmp
    hdl.ts         # .hdl INTERFACE parser (IN/OUT only)
    bus.ts         # Split / Join / Const: busDef (pins+eval from params), parseRanges, busErrors (validation)
    resolve.ts     # chipOf(instance): CHIPS entry or a bus node built from its params
    exercise.ts    # groupExerciseFiles (Name.hdl/.tst/.cmp → chips) and runExercise (.tst + .cmp)
  ui/          # React components (TopBar, Toolbar, Sidebar, Board, nodes, ResultsTable, ExpectedPanel, HelpPanel)
    formatValue.ts   # pure: decimal / grouped binary / hex of a value, bit helpers (toggleBit, bitsMsbFirst)
    chipLayout.ts  # pure geometry: shape, size and pin positions per chip type
    flowToCircuit.ts # React Flow graph → engine Circuit
    busParams.ts     # node data (ranges text) → engine ChipParams; pins of any node (defOfData)
    ranges.ts        # pure: bit ranges on pins (presets, add/remove, validation, compileRanges → Split/Join graph)
    RangeColumn.tsx  # bit strip + range handles of a node (used by chip nodes and pin nodes)
    exercisePins.ts  # pins from an HDL interface; reconcile a saved circuit with a changed interface
    fileLoading.ts   # folder/file pickers and drag & drop (walks dropped folders)
    storage.ts       # safe localStorage autosave; chipSlot = chip name + interface hash; getPref / setPref
    runView.ts       # engine results → rows for the results table
  App.tsx
tests/         # end-to-end tests; fixtures/buses/ = 3 INVENTED chips (hdl/tst/cmp), never the user's files
```

## Engine rules
- Signals are numbers; a pin has a width (1 or 16, sometimes 2/3 for `sel`). Mask values to width.
- Evaluate in topological order; a cycle → clear error, not a hang. The one exception: a feedback loop is legal if it
  passes through a *registered* chip (DFF, DFF16, Bit, Register, ARegister, DRegister, PC: output comes only from
  stored state, `seq.registered`). RAM (RAM8 … RAM16K) is not registered (reading is combinational on `address`), so a
  loop through only RAM is still an error. That is a KNOWN false cycle (e.g. RAM8 out → Inc16 → RAM8 in is rejected
  although real hardware allows it, because `in`/`load` are only sampled at the tick); planned fix: per-input
  combinational dependencies (gate R2).
- Sequential chips are `ChipDef.seq` (`SeqBehavior`: init/read/tick/tock/stored). State is per chip INSTANCE and lives
  in the `Simulator`, never in the chip definition. tick latches inputs, tock commits them (Nand2Tetris model);
  RAM writes happen at tock, reads are combinational.
- A wire connects one source pin to one target pin of the same width; mismatched width → error shown to user.
- Unconnected input pin → error listing which pin.
- Everything that needs a chip's pins calls `chipOf(instance)` (resolve.ts), never `CHIPS[...]` directly, so
  Split/Join/Const (pins depend on `ChipInstance.params`) work everywhere.
- Bus validation (`busErrors`, run by `validateCircuit`): width 1..16; every range inside the bus; no range listed
  twice; **Join**: ranges must not overlap and every output bit must be driven (error lists the undriven bits).
  Overlap on a **Split** is allowed (reading a bit twice is harmless). A wire into/out of a range pin is
  width-checked like any wire.
- `%D` output is signed only for 16-bit pins; narrower buses (sel[3]) print unsigned.
- Every pin and bus is 1..16 bits wide (`MAX_WIDTH` in chips.ts; values are masked with 32-bit operators, a wider mask
  would silently be 0). The .hdl parser rejects `IN a[17]`, auto-created pins re-check it, and `validateCircuit`
  rejects any circuit pin outside 1..16.
- Cost of running a .cmp: `runTests` validates and plans ONCE (`validateCircuit` + `orderChips`) and then calls
  `evaluate()` per row; `validateCircuit` is O(C + W + P) (Map lookups, error text built only on an error). Never put
  validation or planning inside a per-row loop (`perf.test.ts` guards this).
- .hdl: every `IN`/`OUT` declaration must end with `;`; one that does not is a parse error, never silently dropped.
- `.tst`: `repeat N { }` capped at 1,000,000 commands and 5,000,000 loop iterations (empty bodies count), nesting at 100, output rows at 100,000. Commands: `set`, `eval`, `tick`, `tock`, `ticktock` (= tick then
  tock), `output`, `output-list`, `repeat`. `set` values: decimal, `%D`, `%B`, `%X`; a value that does not fit the pin
  width is cut (mask) and reported as a warning, once per distinct message. `output-list` formats
  `%B %D %X %S` (`name%B2.1.2` = pad, length, pad); a new `output-list` REPLACES the active columns (rows use the list
  in effect when `output` ran; `Tst.outputList` is the last one), and `%B`/`%X` columns too short for the value give a
  warning. Unknown commands (while, if ...) → warning and skipped; bus
  indexing (`set a[0] 1`) is an error. Output rows and .cmp rows are compared as trimmed text cells, case-insensitive
  (hex), header ignored; works for sequential .cmp files too (`time` column, `0+`).
- `.cmp` format: header row `|  a  |  b  | out |`, then value rows. Values are binary strings
  (`0`, `1`, `0000000000001111`); may be padded with spaces. Columns are matched to circuit pins by name:
  names matching circuit inputs are inputs, the rest are expected outputs.

## Working rules
- Keep `engine/` free of UI code; every engine function has Vitest tests. Tests live in `src/**/*.test.ts` and
  `tests/**/*.test.ts`; fixtures are invented chips (`tests/fixtures/`), never the user's exercise files.
- Small focused changes; don't refactor unrelated files.
- Run `npm test` after engine changes and `npm run build` before saying a stage is done.
- Explain new tools/concepts briefly in comments — the developer is a 2nd-year CS student.
