// A tiny Hack assembler for TESTS ONLY (never imported by the app): turns lines such as "@21", "D=D+A", "M=-1",
// "D;JGT" or "0;JMP" into 16-bit instruction words, so the golden programs stay readable. No labels or symbols:
// every program in the tests uses explicit numbers, and the expected values are written out by hand next to it.

// comp field (bits zx nx zy ny f no) for the a = 0 forms; the "M" forms are the same with A replaced by M and a = 1.
const COMP: Record<string, number> = {
  '0': 0b101010, '1': 0b111111, '-1': 0b111010,
  D: 0b001100, A: 0b110000, '!D': 0b001101, '!A': 0b110001, '-D': 0b001111, '-A': 0b110011,
  'D+1': 0b011111, 'A+1': 0b110111, 'D-1': 0b001110, 'A-1': 0b110010,
  'D+A': 0b000010, 'D-A': 0b010011, 'A-D': 0b000111, 'D&A': 0b000000, 'D|A': 0b010101,
}
export const COMP_NAMES = Object.keys(COMP)

// jump field bits (j1 j2 j3) = (out < 0, out = 0, out > 0)
export const JUMPS: Record<string, number> = { '': 0, JGT: 1, JEQ: 2, JGE: 3, JLT: 4, JNE: 5, JLE: 6, JMP: 7 }

/** Encodes a C-instruction from its three fields: `a` 0/1, `comp` 6 bits, `dest` 3 bits (A D M), `jump` 3 bits. */
export const cInstruction = (a: number, comp: number, dest: number, jump: number): number =>
  0xe000 | (a << 12) | (comp << 6) | (dest << 3) | jump

export function asm(line: string): number {
  const text = line.trim()
  if (text.startsWith('@')) {
    const n = Number(text.slice(1))
    if (!Number.isInteger(n) || n < 0 || n > 0x7fff) throw new Error(`bad A-instruction ${line}`)
    return n
  }
  const [rest, jump = ''] = text.split(';')
  const [dest, comp] = rest.includes('=') ? rest.split('=') : ['', rest]
  const a = comp.includes('M') ? 1 : 0
  const key = comp.replace(/M/g, 'A')
  if (!(key in COMP)) throw new Error(`unknown comp in ${line}`)
  if (!(jump in JUMPS)) throw new Error(`unknown jump in ${line}`)
  let d = 0
  for (const ch of dest) d |= ch === 'A' ? 4 : ch === 'D' ? 2 : ch === 'M' ? 1 : (() => { throw new Error(`bad dest in ${line}`) })()
  return cInstruction(a, COMP[key], d, JUMPS[jump])
}

export const assemble = (lines: string[]): number[] => lines.map(asm)
