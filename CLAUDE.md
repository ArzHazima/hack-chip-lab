# Hack Chip Lab — Nand2Tetris visual simulator

Web app for wiring Nand2Tetris chips (Hack computer) on a 2D canvas and checking them against course test files.

## Product (MVP)
- Layout: left sidebar = chip palette; center = canvas (the "board"); top bar = Upload .cmp, Show expected,
  clock controls (Clock counter, Tick, Tock, Step, Reset), Run.
- User drags chips from the palette onto the canvas, adds named input/output pins, and connects them with wires.
- Built-in chips (ready-made, black boxes), grouped in the sidebar by Nand2Tetris project (collapsible sections,
  defined in `CHIP_GROUPS` in `chips.ts`):
  - Project 1 – Boolean Logic: Nand, Not, And, Or, Xor, Mux, DMux,
    Not16, And16, Or16, Mux16, Or8Way, Mux4Way16, Mux8Way16, DMux4Way, DMux8Way.
  - Project 2 – Boolean Arithmetic: HalfAdder, FullAdder, Add16, Inc16, ALU
    (ALU = official Hack ALU: inputs x, y, zx, nx, zy, ny, f, no → outputs out, zr, ng).
  - Project 3 – Memory: DFF, DFF16, PC, RAM64, RAM512, RAM4K, RAM16K. Bit, Register and RAM8 are NOT built in:
    the user builds them from DFF + Mux (Register/RAM8 use DFF16 + Mux16; DFF16 = 16 DFFs side by side, a stand-in
    until bus slicing exists, since a 16-bit bus cannot yet be split into 1-bit DFFs).
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
  restarts the simulation. **Run** (combinational .cmp rows) refuses circuits that contain clocked chips.
- Later stages (do NOT build unless asked): uploading/running `.tst` + sequential `.cmp` from the UI,
  saving a user circuit as a reusable chip, bus slicing (`a[0..7]`), `.hdl` export, 3D view.

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
    runTests.ts    # run all .cmp rows against a circuit → results
    tst.ts         # .tst subset (set/eval/tick/tock/output/repeat/output-list) + compareToCmp
  ui/          # React components (Sidebar, Board, TopBar, ResultsTable, ExpectedPanel, nodes)
    chipLayout.ts  # pure geometry: shape, size and pin positions per chip type
    flowToCircuit.ts # React Flow graph → engine Circuit
  App.tsx
```

## Engine rules
- Signals are numbers; a pin has a width (1 or 16, sometimes 2/3 for `sel`). Mask values to width.
- Evaluate in topological order; a cycle → clear error, not a hang. The one exception: a feedback loop is legal if it
  passes through a *registered* chip (DFF, DFF16, PC: output comes only from stored state, `seq.registered`).
  RAM is not registered (reading is combinational on `address`), so a loop through only RAM is still an error.
- Sequential chips are `ChipDef.seq` (`SeqBehavior`: init/read/tick/tock/stored). State is per chip INSTANCE and lives
  in the `Simulator`, never in the chip definition. tick latches inputs, tock commits them (Nand2Tetris model);
  RAM writes happen at tock, reads are combinational.
- A wire connects one source pin to one target pin of the same width; mismatched width → error shown to user.
- Unconnected input pin → error listing which pin.
- `.tst` (engine only): `repeat N { }` capped at 1,000,000 commands; `while`/`if`/bus indexing are rejected with a clear
  error. Sequential .cmp files (`time` column, `0+`) are compared as trimmed text cells via `compareToCmp`.
- `.cmp` format: header row `|  a  |  b  | out |`, then value rows. Values are binary strings
  (`0`, `1`, `0000000000001111`); may be padded with spaces. Columns are matched to circuit pins by name:
  names matching circuit inputs are inputs, the rest are expected outputs.

## Working rules
- Keep `engine/` free of UI code; every engine function has Vitest tests.
- Small focused changes; don't refactor unrelated files.
- Run `npm test` after engine changes and `npm run build` before saying a stage is done.
- Explain new tools/concepts briefly in comments — the developer is a 2nd-year CS student.
