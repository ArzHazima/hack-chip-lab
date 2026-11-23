// Showing a bus value in the formats a student needs: binary (grouped by 4 bits so it is easy
// to read), decimal and hex. Pure functions, no React.

export type FormatMode = 'binary' | 'decimal' | 'hex' | 'all'

/** The toolbar's format switch: Binary / Decimal / Hex / All. */
export const FORMAT_MODES: { id: FormatMode; label: string; title: string }[] = [
  { id: 'binary', label: 'Binary', title: 'Show values in binary, in groups of 4 bits' },
  { id: 'decimal', label: 'Decimal', title: 'Show values in decimal' },
  { id: 'hex', label: 'Hex', title: 'Show values in hexadecimal' },
  { id: 'all', label: 'All', title: 'Show binary, decimal and hex together' },
]

export interface FormattedValue {
  decimal: string
  binary: string // grouped by 4 from the right: "0000 1111 0000 1111"
  hex: string // "0x0F0F"
}

/** Keeps the low `width` bits, like the engine does (a negative number becomes two's complement). */
function wrap(value: number, width: number): number {
  const m = 2 ** width
  return ((Math.trunc(value) % m) + m) % m
}

/** "10101" -> "1 0101": groups of 4, counted from the right (least significant) end. */
export function groupBits(bits: string): string {
  const groups: string[] = []
  for (let end = bits.length; end > 0; end -= 4) groups.unshift(bits.slice(Math.max(0, end - 4), end))
  return groups.join(' ')
}

export function formatValue(value: number, width: number): FormattedValue {
  const v = wrap(value, width)
  return {
    decimal: String(v),
    binary: groupBits(v.toString(2).padStart(width, '0')),
    hex: '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0'),
  }
}

/** One line of text in the chosen format (used for wire labels and tooltips). */
export function valueText(value: number, width: number, mode: FormatMode): string {
  const f = formatValue(value, width)
  if (mode === 'binary') return f.binary
  if (mode === 'decimal') return f.decimal
  if (mode === 'hex') return f.hex
  return `${f.binary} = ${f.decimal} = ${f.hex}`
}

/** The bits of a value, most significant first (the order they are written and shown). */
export function bitsMsbFirst(value: number, width: number): number[] {
  const v = wrap(value, width)
  return Array.from({ length: width }, (_, i) => (v >> (width - 1 - i)) & 1)
}

/** Flips bit number `bit` (0 = least significant). A bit outside the width changes nothing. */
export function toggleBit(value: number, bit: number, width: number): number {
  const v = wrap(value, width)
  return bit < 0 || bit >= width ? v : (v ^ (1 << bit)) >>> 0
}
