# Hack Chip Lab — Nand2Tetris visual simulator

Web app for wiring Nand2Tetris chips (Hack computer) on a 2D canvas and checking them against course test files.

## Product (MVP)
- Layout (top to bottom): **top bar** = app name (left), the SELECTED CHIP as a large dropdown in the center with its
  CMP / TST / HDL file names under it (⚠ for a missing file; on a free board it shows the uploaded files), and the
  **? Help** button (right). **Toolbar** with three labelled groups: **Files** (Load folder, Load files, Load example chips, Upload .cmp,
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
    ARegister / DRegister / DFF / DFF16 / PC have no combinational inputs (loops through their in/load/inc/reset are
    legal, they show a "stored" badge); a RAM's out depends only on `address` (see the engine rules). DFF16 (= 16 DFFs side by side) predates buses and is KEPT because
    the sequential tests build Register/RAM8 from it.
  - Project 5 – Computer (sidebar section "Project 5 – Computer", definitions in `engine/projectFive.ts`; stage 1 of
    `docs/ADR-R2-project5.md`; CPU and Computer are stage 2, next bullet): **ROM32K** (address[15] → out[16], read-only program memory,
    32768 words), **Screen** (in[16], load, address[13] → out[16], 8192 words), **Keyboard** (out[16], the key code that
    is held, 0 = none), **Memory** (in[16], load, address[15] → out[16]: RAM16K at 0..16383, Screen at 16384..24575,
    Keyboard word at 24576 (read-only), 24577..32767 read 0 and ignore writes). Reads are combinational, writes happen at
    tock, memories are `Uint16Array`s allocated once per instance. **Reset** clears RAM / Screen / Memory (`fill(0)`) but keeps
    the ROM32K program and the Keyboard key. The ROM32K block has a dropdown of the loaded `.hack` files and shows how many
    instructions it holds; Keyboard and Memory have a "key" number box (changing it does not restart a running
    simulation). The chosen file name / key are saved in the node data (`hackFile`, `keyValue`; `storage.ts` keeps them).
  - **CPU** (inM[16], instruction[16], reset → outM[16], writeM, addressM[15], pc[15]) and **Computer** (input reset
    only; ROM32K + CPU + Memory with Screen and Keyboard inside one block). Logic in `engine/cpu.ts` (pure: `alu`,
    `cpuOutputs`, `cpuNext`), chip definitions in `engine/projectFive.ts`. Exact timing of A, D and PC, the same two phases
    as every clocked chip: **tick** samples inM, instruction and reset together with the CURRENT A, D, PC and computes the
    next A, D, PC (outputs do not change); **tock** makes them current (addressM and pc change). The ALU reads the OLD A
    and D, a jump goes to the OLD A (even if the same instruction writes A), `reset` forces PC to 0 for that cycle (it beats
    a jump) but the instruction still writes A / D. Only instruction bit 15 chooses A- or C-instruction. PC is 15 bits and
    wraps. Dependencies: `deps = { outM, writeM: [inM, instruction], addressM: [], pc: [] }`, so a fetch loop through `pc`
    is legal and a loop through `outM` (e.g. outM → Memory.address) is a cycle error. For an A-instruction outM is the ALU
    run on the address bits (a "don't care", like the official HDL). Computer: tick fetches rom[PC], reads inM = memory[A],
    computes next registers and a pending write (writeM: address A, value outM); tock commits both. Reset button =
    A, D, PC, RAM, Screen cleared, ROM program and key kept; the `reset` pin only forces PC to 0. The Computer block has the
    same program dropdown as ROM32K plus the key box, and shows PC as its "stored" badge.
  - **Internal state in `.tst` (stage 3, `engine/stateRef.ts`):** `Type[]` / `Type[i]` in `set`, `output-list` and `while`,
    resolved by chip TYPE: depth 0 = a block of that type on the board, depth 1 = inside a CPU / Computer / Memory block
    (`SeqBehavior.exposes`: type to register name, CPU and Computer `{ ARegister: 'A', DRegister: 'D', PC: 'PC' }`;
    `SeqBehavior.exposesWords`: type to word range, Computer and Memory `RAM16K` 0.., `Screen` 16384.., `Keyboard` 24576).
    A pin with that name wins; the shallowest unique candidate is used, several = an error listing them; none = an error
    (for `ARegister` / `DRegister`: "use the ARegister / DRegister block, not a generic Register"). `X[]` and `X[0]` both work
    for a single value (registers, PC, Keyboard); a memory needs `X[i]` (bounds checked). `peek` / `poke` exist on
    DFF, Bit, Register ..., PC, RAMs and the Project 5 memories. **A register's `peek` is the value latched at the tick**
    (`next`), so a script sees `DRegister[]` already new at "1+" like the official CPU.cmp; the output pins change at tock.
    `poke` sets both phases. **Exact `peek` semantics at the tick phase (pinned by `robustness.test.ts`, M4):** after a `tick`
    a register (DFF, Bit, Register ..., PC, CPU A / D / PC) already `peek`s the NEW value (the latch), while its output pin
    still shows the OLD one until the `tock`; a memory word (RAM8 ... RAM16K, Screen, Memory) `peek`s the OLD value after the
    tick and the new one only after the `tock`, because RAM writes are committed at tock. `Simulator.peekRegister / pokeRegister(chipId, 'A' | 'D' | 'PC')`, `peek / poke(chipId, address)`.
    `ROM32K load X.hack` looks X up in the loaded programs (`RunOptions.programs`, case-insensitive, error if missing)
    and loads every ROM32K / Computer. `set Keyboard[] k` sets the key (also inside Memory / Computer).
  - **`.hack` files** (`engine/hack.ts` `parseHack`): one 16-character 0/1 instruction per line; blank lines, spaces,
    a BOM and CRLF are fine; any other line is skipped WITH a warning naming its line number (at most 20 warnings, then
    "... and N more"); more than 32768 instructions is an error. `.hack` is a 4th accepted extension in file loading,
    but it is NOT an exercise chip (`groupExerciseFiles` ignores it); App keeps the parsed programs by file name
    (new loads add to / replace by name) and `flowToCircuit(nodes, edges, programs)` copies the words into
    `ChipInstance.program`. A chosen file that is not loaded is a warning (empty ROM), not an error.
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

- **Live demo / examples:** the app is deployed to GitHub Pages by `.github/workflows/pages.yml` (base path from
  `VITE_BASE`, default `/`). **Load example chips** fetches `public/examples/index.json` + the listed files
  (`fetchExampleFiles` in `fileLoading.ts`, URLs built from `import.meta.env.BASE_URL`) and feeds them to
  `onLoadFiles` like a picked folder. Keep `public/examples/` in sync with the invented fixtures; list new files in
  its `index.json`.

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
    tst.ts         # .tst subset (set/eval/tick/tock/output/repeat/while/echo/ROM32K load/output-list, Type[i] state) + compareToCmp
    stateRef.ts    # Type[] / Type[i] in .tst: resolve a chip TYPE to one instance (block or inside CPU/Computer/Memory)
    hdl.ts         # .hdl INTERFACE parser (IN/OUT only)
    hack.ts        # .hack parser (16-character 0/1 lines → words, warnings with line numbers)
    cpu.ts         # pure Hack CPU logic: alu, cpuOutputs, cpuNext (used by the CPU and Computer chips)
    projectFive.ts # ROM32K, Screen, Keyboard, Memory, CPU, Computer (imported by chips.ts; only types are imported back, no cycle)
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
- **`.tst` format features (stage 3, `engine/tst.ts`):** `time` in output-list (`N+` after a tick, `N` after a tock); `set` values
  `%B %X %D` and negatives; `while x <op> v { }` (= <> < > <= >=, ordering signed for 16-bit values) with a script-wide cap
  of 100,000 loops: a hit throws an internal `StopRun`, the run returns the rows so far plus `TstOutput.stopped` (message names
  the last `echo` and the Keyboard key box); `echo "text"` goes to `TstOutput.info` (shown under the results summary),
  `clear-echo` is a no-op; `load X.hdl`, `output-file`, `compare-to` give one GREY info line each (`Tst.notices`, merged first into `ExerciseRun.info`; never a yellow warning, so a passing official script shows no yellow). The tokenizer keeps `"..."` as one
  token (an unclosed quote ends at the end of its line). `compareToCmp` compares cell by cell by POSITION (header names are
  never used, they may be cut to the column width), an expected cell of only `*` accepts anything.
- **Script limits and stopping (pre-v1.0 robustness):** warnings and info lines are collected in a `Listed` (a Set, O(1) de-dup;
  at most 50 shown plus one "... and N more" line) for parse-time warnings, run-time warnings and info. An output-list column
  has `left + len + right <= 64` and an output-list at most 200 columns (both TstParseError, checked at parse time); all output
  rows together at most 50 million characters and at most 100,000 rows. **Any `CircuitError` raised in the middle of a script**
  (unknown pin, `Type[99999]` out of range, command / loop budget, the limits above) ends the run with `TstOutput.stopped`
  and KEEPS the rows produced so far (the same path as the `while` cap); only an error before the first row is still thrown
  (nothing to keep, the board shows it like any circuit error). A stopped run is never "ok".
- **Rows are small, snapshots are lazy (stage 3):** `runTst` keeps NO wire values. `ExerciseRow` = `{index, pass, expected, actual}`
  (text). `ExerciseRun.replay(i)` re-runs the script with `RunOptions.captureRow = i` (stops at that `output`) and returns the
  `Snapshot`; `RunView.replay` hands it to App, which colours the board for the selected row. 100,000 rows: 10.7 MB
  (it was 618.6 MB with per-row snapshots). `tests/memory.test.ts` now checks 30,000 rows by walking the result and
  counting bytes per row (no GC flags, no heap measurement, so it cannot flake). `ResultsTable` renders only the visible rows above 300
  rows (fixed row height `--result-row-h` = 28 px).
- **Evaluation cache (stage 3):** `Simulator.eval` returns the cached result while the stored state (`version`) and the inputs are
  the same. State changes at tock, reset, poke, loadRom, setKeyboard. A TICK does not change it (it only latches values the tock
  commits; no `read` looks at them). So tick and tock evaluate once each and `output` is free; `Simulator.evalCount` counts real
  evaluations. A new chip whose `read` depended on latched values would break this: keep `read` a function of committed state.
- **Official-file check (`tests/official.test.ts`):** runs the course's Project 5 scripts from the git-ignored `examples/project5/`
  against the built-in chips; skipped when the folder is missing. Never copy those files into the repo.
- Signals are numbers; a pin has a width (1 or 16, sometimes 2/3 for `sel`). Mask values to width.
- Evaluate in topological order; a cycle → clear error, not a hang. Dependencies are PER INPUT PIN: each clocked chip
  declares `seq.combInputs`, the inputs that change its output right now. DFF, DFF16, Bit, Register, ARegister,
  DRegister, PC: `[]` (out comes only from stored state; in/load/inc/reset are sampled at the tick). RAM8 … RAM16K:
  `['address']` (out = memory[address]; in/load are sampled at the tick). A wire into a clocked chip's non-comb input
  creates no ordering edge, so a loop through it is legal (RAM8 out → logic → RAM8 load works, as in the Nand2Tetris
  simulator); a loop through a combinational path (gates only, or RAM out → RAM address) is still a cycle error.
  `evaluate` computes a clocked chip's out from its state (+ comb inputs) in order, and reads its other inputs
  (`chipInputs`, latched at tick) only after everything has settled.
- Sequential chips are `ChipDef.seq` (`SeqBehavior`: init/read/tick/tock/stored). State is per chip INSTANCE and lives
  in the `Simulator`, never in the chip definition. tick latches inputs, tock commits them (Nand2Tetris model);
  RAM writes happen at tock, reads are combinational.
- **Per-output dependencies** (`SeqBehavior.deps`, optional): `deps: { outM: ['inM', 'instruction'], pc: [] }` says which
  inputs each OUTPUT of a clocked chip depends on right now; an output missing from the map uses `combInputs`, so every
  existing chip is unchanged. `orderChips` plans STEPS (`PlanStep = { chip, outputs?, deps? }`, returned by
  `planOrder` / `orderChips` and consumed by `evaluate`): a clocked chip becomes one step per distinct dependency set, a
  wire from output `o` orders the step that produces `o` before every step of the target chip that depends on the
  target pin. `read(inp, state)` of such a chip gets ONLY the inputs of one group and must compute each output from its
  own deps. Result: ROM.out → CPU.instruction → CPU.pc/addressM → ROM.address is a legal fetch loop when `pc` has no
  deps, but a loop through an output that DOES depend on the input (`outM` → address) is still a cycle error.
  The built-in CPU is the only chip that uses `deps` (a test-only chip covers the generic rule too). A clocked chip
  WITHOUT outputs (Computer) is still one step (`outputs: []`), otherwise it would never run and never latch its inputs.
- Clocked chips can implement optional hooks: `init(inst)` (gets the circuit instance: ROM32K `program`, Keyboard `key`),
  `reset(state)` (keep program / key, clear memories in place; without it the state is recreated), `loadRom`, `setKey`,
  `peek` / `poke`. `Simulator` exposes `loadRom(words)`, `setKeyboard(key, chipId?)`, `peek(chipId, i)`, `poke(...)`.
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
  warning. Unknown commands (if ...) → warning and skipped; bus
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
