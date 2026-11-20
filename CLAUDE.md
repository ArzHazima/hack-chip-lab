# Hack Chip Lab — Nand2Tetris visual simulator

Web app for wiring Nand2Tetris chips (Hack computer) on a 2D canvas and checking them against course test files.

## Product (MVP)
- Layout: left sidebar = chip palette; center = canvas (the "board"); top bar = Upload test file, Run.
- User drags chips from the palette onto the canvas, adds named input/output pins, and connects them with wires.
- Built-in chips (ready-made, black boxes): Nand, Not, And, Or, Xor, Mux, DMux,
  Not16, And16, Or16, Mux16, Or8Way, Mux4Way16, Mux8Way16, DMux4Way, DMux8Way.
- User uploads a `.cmp` file and clicks **Run** → every row is evaluated, results table shows ✅/❌ per row.
  Clicking a row loads its input values onto the canvas and colors wires by value (1 = green, 0 = gray).
- Later stages (do NOT build unless asked): `.tst` parsing, sequential chips (DFF, Bit, Register, RAM8, clock),
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
    simulate.ts    # topological evaluation of a circuit for given inputs
    cmp.ts         # .cmp parser
    runTests.ts    # run all .cmp rows against a circuit → results
  ui/          # React components (Sidebar, Board, TopBar, ResultsTable)
  App.tsx
```

## Engine rules
- Signals are numbers; a pin has a width (1 or 16, sometimes 2/3 for `sel`). Mask values to width.
- Combinational only in MVP: evaluate in topological order; a cycle → clear error, not a hang.
- A wire connects one source pin to one target pin of the same width; mismatched width → error shown to user.
- Unconnected input pin → error listing which pin.
- `.cmp` format: header row `|  a  |  b  | out |`, then value rows. Values are binary strings
  (`0`, `1`, `0000000000001111`); may be padded with spaces. Columns are matched to circuit pins by name:
  names matching circuit inputs are inputs, the rest are expected outputs.

## Working rules
- Keep `engine/` free of UI code; every engine function has Vitest tests.
- Small focused changes; don't refactor unrelated files.
- Run `npm test` after engine changes and `npm run build` before saying a stage is done.
- Explain new tools/concepts briefly in comments — the developer is a 2nd-year CS student.
