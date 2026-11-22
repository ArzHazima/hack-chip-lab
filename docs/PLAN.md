# Hack Chip Lab — project plan

## Goal
A web app for **wiring Nand2Tetris chips visually** and checking them against the course's own test files.
The user loads a folder of exercises (`Name.hdl`, `Name.tst`, `Name.cmp`), builds the chip on a canvas from
built-in chips, and presses Run to see a pass/fail result per test row. The app is generic: it never
hardcodes chip or exercise names.

## Architecture (details live in `CLAUDE.md`)
- **Stack:** Vite + React + TypeScript (strict), `@xyflow/react` for the canvas, Vitest. No backend;
  state is in memory, with `localStorage` only for autosave (always inside try/catch).
- **`src/engine/`** — pure TypeScript, no React.
  - `chips.ts` built-in chips (Project 1–3 incl. DFF/PC/RAM) · `bus.ts` Split/Join/Const nodes ·
    `resolve.ts` instance → chip definition · `circuit.ts` circuit model.
  - `simulate.ts` validation, topological order, `evaluate()` · `sequential.ts` `Simulator`
    (per-instance state, tick/tock/step/reset).
  - `cmp.ts`, `tst.ts`, `hdl.ts` parsers (`.cmp`, a `.tst` subset, `.hdl` *interface only*) ·
    `runTests.ts`, `exercise.ts` run a `.cmp` / a `.tst` + `.cmp` and compare.
- **`src/ui/`** — React components: sidebar palette, board (React Flow nodes with SVG gate shapes),
  top bar (folder loading, chip selector, clock buttons), results table, banners; helpers for
  file loading / drag & drop, pins from an HDL interface, per-chip autosave.
- **Rules:** `engine/` never imports UI code; every engine function has tests; feedback loops are
  allowed only through a DFF/PC; every pin and bus is 1..16 bits wide.

## Roadmap
Done:
1. Simulation engine and tests. 2. UI: palette, board, `.cmp` Run, results.
3. Gate-shaped symbols, project groups, "Show expected". 4. Sequential chips: DFF, PC, RAM, Tick/Tock/Step.
5. Delete nodes/wires. 6. Chip selector from an exercise folder (`.hdl` interface → pins, `.tst` + `.cmp` Run).
7. Buses: Split / Join / true / false. 8. Code-review fixes: run a `.cmp` in linear time, `ticktock`,
   warnings instead of silent truncation, interface-aware autosave keys.

Next (not started):
- **Reusable user-made chips:** a chip library, hierarchical state, per-pin combinational dependencies.
- **Memory / CPU / Computer:** ROM32K with a `.hack` program, Screen/Keyboard, `.tst` access to internal
  chip state (`RAM16K[0]`, `PC[]`), a faster compiled evaluation plan, a memory viewer.
- UI hardening: fewer re-renders while dragging, virtualized result tables, UI-level tests.
- Possible extras: `.hdl` export, 3D view.

## How to run things
```bash
npm ci            # install exactly what package-lock.json says
npm run dev       # development server (http://localhost:5173)
npm test          # run all Vitest tests once
npx tsc -b        # type check
npm run build     # type check + production build into dist/
```
Tests live in `src/**/*.test.ts` and `tests/**/*.test.ts`. The fixtures under `tests/fixtures/` are
**invented** chips; they are never copies of real course files. A local `examples/` folder with real
exercises is ignored by git on purpose.

## Definition of done for a stage
`npm test`, the type check and `npm run build` all pass; `CLAUDE.md` is updated; one commit per stage.
