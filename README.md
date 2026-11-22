# Hack Chip Lab

A web app for **building Nand2Tetris chips visually**: drag built-in chips onto a canvas, wire them
together, and check the result against the exercise's own `.tst` / `.cmp` files, with a ✅ / ❌ for every row.

> _Screenshot placeholder: save a screenshot as `docs/screenshot.png` and replace this line with
> `![Hack Chip Lab](docs/screenshot.png)`._

## Run it

You need [Node.js](https://nodejs.org/) (current LTS).

```bash
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).

## Load your exercises

Put each chip's three files in one folder, with the same base name:

```
my-exercises/
  Mux4Way16.hdl
  Mux4Way16.tst
  Mux4Way16.cmp
  Xor.hdl
  Xor.tst
  Xor.cmp
```

1. Click **Load folder** (or **Files…**, or just drag the folder onto the page).
2. Pick a chip in the dropdown. Its input and output pins appear on the board automatically,
   taken from the `IN` / `OUT` lines of the `.hdl` (the `PARTS` section is ignored).
3. Build the circuit from the sidebar: built-in chips, and the **Wiring** section
   (Split, Join, true, false) for buses.
4. Press **Run**. Click a result row to see its values on the board (wires turn green for 1, gray for 0).

A chip with a missing file is still listed, marked with ⚠. Each chip keeps its own circuit, saved in
your browser.

## Tests

```bash
npm test          # all unit and end-to-end tests
npx tsc -b        # type check
npm run build     # type check + production build
```

## Current limitations

- Combinational chips are fully supported; sequential support is basic (DFF, PC, RAM chips with
  Tick / Tock / Step and `tick` / `tock` / `ticktock` in `.tst` scripts).
- **No CPU / Computer yet:** there is no ROM, screen or keyboard, and `.hack` programs cannot be loaded.
- You cannot save your own circuit as a reusable chip, and the `.hdl` implementation is not imported
  (only its interface).
- Only a subset of the `.tst` language is supported (`set`, `eval`, `tick`, `tock`, `ticktock`,
  `output`, `output-list`, `repeat`); other commands are skipped with a warning.
- Every pin and bus is at most 16 bits wide.

## License

MIT, see [LICENSE](LICENSE).
