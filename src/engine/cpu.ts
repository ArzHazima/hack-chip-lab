// Pure logic of the Hack CPU (no chips, no clock): the ALU, the control bits and the next values of A, D and PC.
// Used by the built-in CPU chip and by the built-in Computer chip, so both behave identically.
//
// Instruction format (bit 15 is the most significant):
//   A-instruction:  0vvv vvvv vvvv vvvv          A = the 15-bit value v
//   C-instruction:  111a cccc ccdd djjj
//     a      0: the ALU reads A, 1: it reads inM (memory[A])
//     cccccc zx nx zy ny f no (bits 11..6), the ALU control bits
//     ddd    destination bits 5 (A), 4 (D), 3 (M)
//     jjj    jump bits 2 (out < 0), 1 (out = 0), 0 (out > 0)
// Only bit 15 decides between the two kinds (like the official CPU): bits 14 and 13 of a C-instruction are ignored.

export interface CpuRegs {
  a: number // 16 bits
  d: number // 16 bits
  pc: number // 15 bits
}

const M16 = 0xffff
const M15 = 0x7fff
const bit = (v: number, k: number): number => (v >> k) & 1

/** The Hack ALU on 16-bit values. Control bits are applied in this order: zx/nx on x, zy/ny on y, f, no. */
export function alu(x: number, y: number, zx: number, nx: number, zy: number, ny: number, f: number, no: number): number {
  if (zx) x = 0
  if (nx) x = ~x & M16
  if (zy) y = 0
  if (ny) y = ~y & M16
  let out = f ? (x + y) & M16 : x & y
  if (no) out = ~out & M16
  return out
}

export interface CpuOutputs {
  outM: number // the ALU output (for an A-instruction it is the ALU run on the address bits: a "don't care")
  writeM: number // 1 for a C-instruction whose destination includes M
}

/**
 * The combinational outputs outM and writeM for the CURRENT registers, the memory input and an instruction.
 * (addressM = A and pc = PC need no inputs at all.)
 */
export function cpuOutputs(regs: CpuRegs, inM: number, instruction: number): CpuOutputs {
  const y = bit(instruction, 12) ? inM & M16 : regs.a
  const outM = alu(regs.d, y, bit(instruction, 11), bit(instruction, 10), bit(instruction, 9), bit(instruction, 8), bit(instruction, 7), bit(instruction, 6))
  const isC = bit(instruction, 15) === 1
  return { outM, writeM: isC && bit(instruction, 3) === 1 ? 1 : 0 }
}

/**
 * The registers after this instruction. Everything is computed from the OLD registers: the ALU reads the old A and D,
 * and a jump goes to the old A, even if the same instruction writes A.
 * reset forces PC to 0 (it beats a jump) but does not stop the instruction from writing A or D.
 */
export function cpuNext(regs: CpuRegs, inM: number, instruction: number, reset: number): CpuRegs {
  const isC = bit(instruction, 15) === 1
  const { outM } = cpuOutputs(regs, inM, instruction)
  let a = regs.a
  let d = regs.d
  let jump = false
  if (isC) {
    if (bit(instruction, 5)) a = outM
    if (bit(instruction, 4)) d = outM
    const ng = bit(outM, 15) === 1
    const zr = outM === 0
    jump = (bit(instruction, 2) === 1 && ng) || (bit(instruction, 1) === 1 && zr) || (bit(instruction, 0) === 1 && !ng && !zr)
  } else {
    a = instruction & M16
  }
  const pc = reset ? 0 : jump ? regs.a & M15 : (regs.pc + 1) & M15
  return { a, d, pc }
}
