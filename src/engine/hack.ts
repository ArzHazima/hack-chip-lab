// .hack parser: a Hack machine-language program, one 16-character instruction (0/1) per line.
// Pure TS (no React). Invalid lines are never dropped silently: each one gives a warning with its line number.

/** ROM32K holds 2^15 instructions. */
export const MAX_HACK_LINES = 32768
/** A junk file must not produce thousands of warnings; the rest is summarised in one line. */
const MAX_WARNINGS = 20

export class HackParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HackParseError'
  }
}

export interface HackProgram {
  words: number[] // one number (0..65535) per valid instruction, in file order
  warnings: string[] // one per skipped line (line numbers start at 1)
}

const INSTRUCTION = /^[01]{16}$/

/**
 * Parses the text of a .hack file. Tolerates blank lines, spaces around a line, a BOM and any line ending
 * (LF, CRLF, CR). A line that is not exactly 16 characters of 0/1 is skipped WITH a warning (the addresses of
 * the instructions after it shift down by one, and the warning says so).
 * More than 32768 instructions cannot fit in ROM32K: that is an error naming the first line that does not fit.
 */
export function parseHack(text: string): HackProgram {
  const words: number[] = []
  const warnings: string[] = []
  let skipped = 0
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    if (!INSTRUCTION.test(line)) {
      skipped++
      if (warnings.length < MAX_WARNINGS) {
        const shown = line.length > 24 ? `${line.slice(0, 24)}…` : line
        warnings.push(`line ${i + 1}: "${shown}" is not 16 characters of 0/1, skipped (later instructions move up by one address)`)
      }
      continue
    }
    if (words.length >= MAX_HACK_LINES) {
      throw new HackParseError(`line ${i + 1}: the program has more than ${MAX_HACK_LINES} instructions, which do not fit in ROM32K`)
    }
    words.push(parseInt(line, 2))
  }
  if (skipped > warnings.length) warnings.push(`… and ${skipped - warnings.length} more invalid lines`)
  return { words, warnings }
}
