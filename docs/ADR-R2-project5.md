# ADR R2 — Nand2Tetris Project 5 (Memory, CPU, Computer)

Status: proposed (design only, no code changed). Date: 2026-11-26.

## Goal
(a) Built-in blocks **ROM32K, Screen, Keyboard, Memory, CPU, Computer**. (b) The user builds their own Memory, CPU
and Computer on the board and runs the official `.tst`/`.cmp` for them, including running a `.hack` program on Computer.
Official course files are NOT copied; fixtures are small invented chips and hand-written programs. Anything below that
describes the official scripts is from memory of the public course format and must be checked against the user's own copies.

## What the code does today (relevant facts)
- `Simulator` = `planOrder` once + `evaluate()` per call. State lives per instance in a `Map` (`SeqBehavior`: init/read/tick/tock/stored).
  A step calls `evaluate` twice (tick, tock); a `.tst` `output` calls it again and copies a full `wireValues` map into every row snapshot.
- Ordering is per chip INPUT pin (`combInputs`). There is no per-OUTPUT dependency: all outputs of a chip are "ready" together.
- `tst.ts` accepts `load ...` (ignored), `set pin v` (bus indexing is an error), `output-list` columns `name%B1.2.3`
  (regex `[A-Za-z_]\w*` — no brackets). `ROM32K load X.hack` today = "unknown command, skipped" (silent wrong results risk).
- `groupExerciseFiles` only knows hdl/tst/cmp. Pins max 16 bits (Project 5 needs 16: `address[15]`, `instruction[16]` — fits).
- No hierarchy: a chip's own board is saved per chip (`hacklab:circuit:<name>#<hash>`) but cannot be used as a block elsewhere.

## Decisions

### 1. Addressing internal state from `.tst`
Needed forms: `ROM32K load Add.hack`, `set RAM16K[3] 5`, `output-list RAM16K[3]%D1.7.1`, `PC[]`, `DRegister[]`, `ARegister[]`
(also `Screen[i]`, `Keyboard[]` for set).

| Option | Rule | + | − |
|---|---|---|---|
| A. By chip TYPE (recommended) | `Type[]` / `Type[i]` = the instance of built-in type `Type` in the (flattened) circuit | same as the official simulator; the official CPU/Computer scripts need nothing else | ambiguous with two instances |
| B. By user label | user names a node, `.tst` says `cpu_d[]` | unambiguous | official scripts use type names, so the user must label by hand — breaks "load folder and Run" |

**Rule (minimal, enough for CPU.tst, Memory.tst, Computer.tst):**
1. A token `X` or `X[...]` is a PIN if the circuit has a pin named `X` (today's behaviour, incl. the bus-indexing error).
   Otherwise it is a STATE REFERENCE `Type` + optional index; `Type` must be a built-in with state.
2. Resolve once, before the run: the instances of `Type` in the flattened circuit. One → use it. Several → take the one with the
   smallest hierarchy depth if that is unique, else an error listing them ("2 DRegister chips; keep one or delete the other").
   None → error "no DRegister in this circuit".
3. `Type[]` = the single value (Register/ARegister/DRegister/Bit/DFF = value, PC = counter, Keyboard = key code).
   `Type[i]` = word i of a memory (RAM8..RAM16K, Screen, ROM32K read-only for `output`).
4. Native composites (built-in CPU / Memory / Computer) declare which inner types they `expose` (`CPU` exposes ARegister,
   DRegister, PC; `Computer` exposes those plus RAM16K, Screen, ROM32K, Keyboard). So `DRegister[]` works with a built-in CPU
   block AND with a user-built CPU made of the built-in `DRegister` — same rule, no label needed.
5. API (additive to `SeqBehavior`, existing chips unchanged except DFF/Register/PC/RAM get a 3-line `peek`/`poke`):
   `peek(state, index?)`, `poke(state, index, v)`. `ROM32K load F` calls `loadRom(words)` on every ROM32K (Computer has one).
6. `ROM32K load Add.hack`: the web app has no file system, so `Add.hack` is looked up among the loaded exercise files by base
   name (`.hack` becomes a 4th extension in `groupExerciseFiles`, shown in the chip's file list but never "missing" — only needed
   by Computer). Not found → clear error pointing to **Load .hack**.
7. `.tst` parser: `Name load file` and `Name[i] value` are recognized statements; output-list columns accept `Type[]`/`Type[i]`.
   `.cmp` comparison is unchanged (text cells).

### 2. Reusable user-made chips — needed?
- Memory is about 10–20 nodes and CPU about 30–60 nodes (ALU, 2 Mux16, ARegister, DRegister, PC, ~10 gates, bit ranges; ranges
  compile into extra Split/Join nodes, so the engine sees 80–150). **Flat is feasible, with the already-built bit ranges.**
- A flat Computer (CPU + Memory + ROM32K) is ~150–250 engine nodes on one canvas: runnable (see 3) but not readable.
- **Required first for CPU and Memory: nothing.** They only need built-ins plus the state rules of decision 1.
- **For Computer from the user's OWN CPU and Memory: hierarchy is required.** Without it the user can still build Computer
  from built-in CPU + Memory + ROM32K blocks (goal (a) holds; the "my own parts" part of goal (b) does not).
- Smallest feature: **"My chips"** — every exercise chip that has a saved board becomes a block in a sidebar section (pins
  from its `.hdl`). Pure `flattenCircuit(circuit, lookup)` in `engine/` inlines it at Run time (ids `cpu/alu1`, cycle and depth ≤ 8 → error, interface-hash
  mismatch → error). A chip without a saved board is used as the built-in of the same name, with a visible badge. Hiding the
  built-in of the chip under test stays. No `.hdl` export, no editing "inside" a block (open that chip from the dropdown). Size: L.
  **Postponable**; v1 works without it.

### 3. Speed
Benchmark (script kept outside the repo; synthetic circuit of PC, Inc16, RAM16K, Register plus N chained ALU/Mux16/And16/Not16/Add16,
`Simulator.step()` after warm-up, Node 24):

| engine nodes | now: µs / clock cycle | cycles / s | prototype typed-array loop (hand-coded ops) |
|---|---|---|---|
| 24 | 86 | 11,600 | 0.04 µs |
| 64 | 236 | 4,200 | 0.20 µs |
| 154 | 459 | 2,200 | 0.57 µs |
| 404 | 2,132 | 470 | 1.96 µs |

Reading: a flat Computer (~200 nodes) runs about 1,500–2,000 cycles/s. Official test scripts need tens to a few thousand
cycles → seconds at worst, **acceptable without a rewrite**. Running a real program (Rect, Pong) needs 10⁵–10⁶ cycles/s →
**not acceptable for a user-built Computer**; the built-in native Computer is fast regardless. The prototype is not the real
engine (gates are 1-line ops), so expect "real compiled" at 5–10× the prototype, still ~50–100× faster than now.

**Compile-once plan** (`engine/compile.ts`, same `Simulator` facade):
1. After `validateCircuit`/`orderChips`, number every endpoint → slot in one `Int32Array values`; chips → flat list in topo order with
   `inSlots[]`, `outSlots[]`, and a monomorphic op (`switch(opcode)` for gates; native functions for Add16/ALU/RAM).
2. State in typed arrays owned by the compiled object (`Uint16Array` per RAM/ROM/Screen, registers in one `Int32Array`); tick latches
   into a `next` array, tock copies. No object/Map/string allocation per cycle.
3. `evaluate()` stays as the **oracle**: a differential test runs random circuits and all fixtures through both and compares every wire.
4. Wire values for the UI are read from the slot array only when a row/live view needs them.
Do the cheap fix inside this stage: tick and tock evaluate once each, and a `.tst` `output` reuses the last evaluation if nothing changed.

### 4. Memory model
- Plain `Uint16Array`: RAM16K 16,384 words, Screen 8,192, ROM32K 32,768 (all allocated once per simulator instance, never per cycle).
- Memory map (built-in `Memory`, address[15]): 0–16383 RAM, 16384–24575 Screen, 24576 Keyboard (read-only), above → 0 (no write).
  `Memory` = one native chip (`combInputs: ['address']`, write at tock like RAM). Screen pixel: word w, bit b (LSB first) → x = (w % 32)·16 + b, y = ⌊w / 32⌋.
- **Reset** = `fill(0)` on RAM and Screen; the loaded ROM program and the keyboard value are kept (Reset clears the machine, not the program).
  Changing the circuit rebuilds the simulator and re-applies the stored program.
- Pending write = two ints (`pendAddr`, `pendVal`), not an array per tock.
- **Row snapshots:** rows keep only the formatted strings plus the small `inputs/outputs` maps. The per-row `wireValues` copy
  (O(rows × wires): 100,000 rows × 300 wires is ~30 M entries) is replaced by **lazy replay**: clicking row *r* re-runs the
  deterministic script up to the *r*-th `output` and captures that one snapshot. Rejected alternative: periodic checkpoints of all
  memories (48 KB each) — more code, same result. Live memory contents are shown by the viewer from the current state, not per row.

### 5. UI — "Computer view" (minimal)
One collapsible panel under the board, shown when the circuit contains a Computer / Screen / ROM32K (or on demand):
- Controls: **Run / Pause / Step** (one clock) and a speed select (1, 10, 100, 1k, max cycles per frame via `requestAnimationFrame`, time-boxed to ~12 ms per frame so the page stays responsive).
- **Screen:** `<canvas>` 512×256, redrawn from the Screen words only when a `version` counter changed (ImageData, black on white).
- **Keyboard:** the canvas takes focus; `keydown`/`keyup` set the Keyboard value (ASCII; Enter 128, Backspace 129, arrows 130–133, Home/End 134/135,
  PgUp/PgDn 136/137, Insert/Delete 138/139, Esc 140, F1–F12 141–152). Pure `keyToHack(event)` is unit-tested.
- **Memory viewer:** table of 16 words per row (hex + decimal), page selector (RAM / Screen / ROM), "go to address", PC and A/D shown.
- **Load .hack** button (also in the Files group); a program loaded from the folder is offered in a dropdown. `.hack` lines must be 16 chars of 0/1, ≤ 32,768 lines,
  else an error naming the line.
Not in v1: breakpoints, assembler, disassembly, VM, saving memory.

## Engine problem found while designing (affects the plan)
A native `CPU` block has outputs with **different** dependencies: `addressM`, `pc` come from registers only; `outM`, `writeM`
depend on `inM`/`instruction`. With today's "all outputs ready together" ordering, `Computer` = ROM32K(address ← CPU.pc) →
CPU(instruction) is a **cycle** (and so is Memory ↔ CPU), although real hardware has none.
- Option 1 (recommended): per-OUTPUT dependencies: `SeqBehavior.deps: { outM: ['inM','instruction'], addressM: [], pc: [] }`;
  `orderChips` sorts (chip, output-group) nodes; `combInputs` stays as the shorthand for "all outputs depend on these".
- Option 2: model the native CPU as two internal nodes (`state half`, `comb half`). Simpler in the planner, but the block on the board
  would need a hidden second node and per-node wire colouring gets confusing.
User-built CPUs are made of fine-grained parts and need neither.

## Staged plan (S = 1 session, M = 2, L = 4)
| # | Stage (one goal) | Gate / test | Size | Droppable? |
|---|---|---|---|---|
| 1 | Memory system: ROM32K, Screen, Keyboard, Memory chips; `.hack` parser (+ `.hack` in `groupExerciseFiles`); `peek/poke/loadRom/setKey` API; per-output `deps` in the planner | unit tests per chip (map boundaries 16383/16384/24575/24576, write at tock, Screen bit mapping); cycle test: Memory + ROM32K + registers loop plans; existing 195+ tests unchanged | M | no |
| 2 | Native CPU and Computer blocks (shared `cpuStep`), `expose` for internal types | golden tests with invented `.hack`: add 2+3→RAM[0], countdown loop, max of two, fill-screen word, jump/branch table (all 8 jump codes, D/M dest combos) | M | no |
| 3 | `.tst` internal state: `ROM32K load`, `Type[]`, `Type[i]` in set/output/output-list, resolution rule, errors; lazy snapshot replay | invented Memory/CPU/Computer `.tst`+`.cmp` in official layout, run against boards built from built-ins (fixture circuit JSON); ambiguity and missing-file errors; replay equals eager snapshot on small runs | M | no |
| 4 | Computer view panel + Load .hack + keyboard/screen | `keyToHack` and screen-render unit tests; manual run of Rect-like program in browser; no horizontal scroll at 1280 px | M | **postponable** (tests already pass without it) |
| 5 | Compile-once engine behind the same `Simulator` | differential test vs `evaluate()` on random circuits + all fixtures; benchmark ≥ 20× on 154-node circuit; `perf.test.ts` guards | M | **postponable**, recommended before 4 if users run real programs on a user-built Computer |
| 6 | "My chips": hierarchy via `flattenCircuit` | flatten unit tests (ids, nested, cycle, depth, hash mismatch); invented 3-level fixture; `DRegister[]` found through 2 levels | L | **postponable** (needed only for Computer built from the user's own CPU/Memory) |
| 7 | Examples, Help text, CHANGELOG, `public/examples` additions (invented), README | `examples.test.ts` extended; `npm test` and `npm run build` | S | no |

Total 15 sessions; **minimum v1.0 = stages 1, 2, 3, 7 = 7 sessions**; recommended = + 5 and 4 = 11; full = 15.
Order is by dependency: 1 → 2 → 3 first (all correctness, run on the existing engine); 5 can slide earlier if speed bites; 6 last.

## Risks and what to test
1. **Semantic fidelity of the clocked model.** ROM/Memory reads are combinational; PC, registers and RAM writes commit at tock;
   `.tst` rows at `0+`/`1`. A one-phase-off error passes small tests and fails official `.cmp`. Test: hand-trace tables for each golden program
   (time, pc, A, D, RAM) written before the code; every jump condition; `reset` priority; write when `writeM` and `addressM` change the same cycle.
2. **Official script/format fidelity** (I do not have the files here; format is from the public course description). Likely features: `load X.hdl,`
   `output-file`, `compare-to`, `output-list time%S0.4.0 DRegister[]%D1.6.1`, `ROM32K load Name.hack`, `set RAM16K[0] n`, `%B`-width columns, many rows.
   Mitigation: tolerant parser plus warnings (never silent skips), tests on invented files in the same layout, and a "run your own folder" check by the user
   with their real copies before declaring v1.0. Never commit course files.
3. **Performance and memory.** User-built Computer ≈ 2k cycles/s now; per-row `wireValues` snapshots explode on long scripts; `repeat` caps (1 M commands,
   100 k rows) were chosen for gates, not for CPUs. Mitigation: lazy replay (stage 3), compile-once (stage 5), cycle budget message with a "stopped after N cycles" row instead of a hang.
Also: scope creep of hierarchy (stage 6) — keep "no editing inside a block, no `.hdl` export".

Testing summary: unit per chip; golden `.hack` programs with hand-computed tables; differential test (compiled vs oracle); `.tst`/`.cmp` fixtures in official
layout (invented); adversarial cases (huge `.hack`, 32,769 lines, non-binary lines, `Type[99999]`, ambiguous types, a `.tst` that sets Keyboard); keep `security.test.ts` style caps.

## Stage 1 as built (2026-11-26)
Changes from the design above, and why:
- **`.hack` is NOT a chip extension in `groupExerciseFiles`** (decision 1.6 said it would be). A lone `Add.hack` would show up in the chip dropdown as a chip with three missing files. File loading accepts `.hack`; `App` parses the files into a separate list of programs (by file name, new loads add to / replace by name).
- **The ROM program reaches the engine through the circuit instance** (`ChipInstance.program`, read by `init(inst)`), plus `Simulator.loadRom(words)`. This lets `Reset` keep the program with no special case, and a ROM32K block pick its file from the board. `ROM32K load X.hack` in a `.tst` is still stage 3.
- **`peek` / `poke` exist only on the new memories and `Keyboard`** (not yet on Register, PC, RAM8..RAM16K): nothing uses them before stage 3, so adding them now would be untested code.
- **Keyboard and Memory have a "key" number box on the board** (not only the Computer view of stage 4), so the memory map can be tried by hand. It writes `keyValue` into the node data.
- **`planOrder` / `orderChips` return `PlanStep[]`** (`{ chip, outputs?, deps? }`) instead of `string[]`; `evaluate` takes the same. Only `perf.test.ts` and `runTests.ts` pass it through. No built-in chip uses `deps` yet: the native CPU is stage 2, so the rule is tested with a test-only chip that has the CPU's dependencies (`outM` on `inM`/`instruction`; `pc`, `addressM` on nothing).
- **More than 32768 `.hack` instructions is an error** (as designed); invalid lines are skipped with a warning naming the line, and the warning says later instructions move up by one address.
- **Not done in this stage (still open in the plan):** the "tick and tock evaluate once each" cheap fix, and the lazy snapshot replay.

## Stage 2 as built (2026-11-26)
- **CPU timing is defined exactly** (the ADR only said "hand-trace tables"): tick samples inM, instruction, reset and the
  current A, D, PC and computes the next ones; tock commits. The ALU and a jump use the OLD A and D. `reset` forces PC to
  0 for that cycle and does not stop the instruction from writing A or D (as the official HDL, where reset only drives
  the PC). Only instruction bit 15 is decoded as A/C; bits 14 and 13 are ignored.
- **`deps` as designed:** `outM`, `writeM` depend on `inM` and `instruction`; `addressM` and `pc` on nothing. `writeM` also
  depends on `inM` in the declaration (the ADR listed only `instruction`) because both come out of one group; this only
  makes the planner slightly more conservative and removes nothing legal that a real wiring needs.
- **A chip without outputs needed a planner fix** (Computer): it was given no step, so its inputs were never latched.
- **`expose` is a table, not yet a lookup:** `SeqBehavior.exposes` (type to register name) plus `peekReg` / `pokeReg` and
  `Simulator.peekRegister / pokeRegister`. The ADR's `peek(state, index?)` stays for memory words. The `Type[]` resolution
  rule and the `.tst` syntax are still stage 3.
- **Computer has the program dropdown and a key box**, not the ADR's separate Computer view (stage 4).
- **Speed (decision 3):** the native Computer measures about 400,000 cycles per second; ROM32K + CPU + Memory blocks wired
  on the board about 77,000. A CPU built from gates is still expected near the ADR's 2,000 per second, so stage 5
  (compile-once) is still the answer for user-built machines.
