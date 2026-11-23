import { describe, expect, it } from 'vitest'
import { bitsMsbFirst, formatValue, groupBits, toggleBit, valueText, FORMAT_MODES } from './formatValue'

describe('formatValue', () => {
  it('16 bits: decimal, binary grouped by 4, hex', () => {
    expect(formatValue(0x0f0f, 16)).toEqual({ decimal: '3855', binary: '0000 1111 0000 1111', hex: '0x0F0F' })
    expect(formatValue(0, 16)).toEqual({ decimal: '0', binary: '0000 0000 0000 0000', hex: '0x0000' })
    expect(formatValue(0xffff, 16).binary).toBe('1111 1111 1111 1111')
  })

  it('works for every width, grouping from the right so the last group is always 4 bits', () => {
    expect(formatValue(1, 1)).toEqual({ decimal: '1', binary: '1', hex: '0x1' })
    expect(formatValue(5, 3)).toEqual({ decimal: '5', binary: '101', hex: '0x5' })
    expect(formatValue(21, 6)).toEqual({ decimal: '21', binary: '01 0101', hex: '0x15' })
    expect(formatValue(0xabc, 12)).toEqual({ decimal: '2748', binary: '1010 1011 1100', hex: '0xABC' })
    expect(formatValue(0x1ff, 9).binary).toBe('1 1111 1111')
    expect(formatValue(255, 8).hex).toBe('0xFF')
  })

  it('pads with leading zeros up to the width', () => {
    expect(formatValue(2, 8).binary).toBe('0000 0010')
    expect(formatValue(2, 16).hex).toBe('0x0002')
  })

  it('values outside the width are masked like the engine does (two\'s complement for negatives)', () => {
    expect(formatValue(70000, 16).decimal).toBe('4464') // 70000 - 65536
    expect(formatValue(-1, 4)).toEqual({ decimal: '15', binary: '1111', hex: '0xF' })
    expect(formatValue(-1, 16).hex).toBe('0xFFFF')
  })

  it('groupBits groups a plain bit string from the right', () => {
    expect(groupBits('')).toBe('')
    expect(groupBits('1')).toBe('1')
    expect(groupBits('10101')).toBe('1 0101')
    expect(groupBits('0000111100001111')).toBe('0000 1111 0000 1111')
  })
})

describe('valueText (one string for a wire label or tooltip)', () => {
  it('shows what the chosen format asks for', () => {
    expect(valueText(3855, 16, 'binary')).toBe('0000 1111 0000 1111')
    expect(valueText(3855, 16, 'decimal')).toBe('3855')
    expect(valueText(3855, 16, 'hex')).toBe('0x0F0F')
    expect(valueText(3855, 16, 'all')).toBe('0000 1111 0000 1111 = 3855 = 0x0F0F')
  })

  it('lists exactly the four modes shown in the toolbar switch', () => {
    expect(FORMAT_MODES.map((m) => m.id)).toEqual(['binary', 'decimal', 'hex', 'all'])
    expect(FORMAT_MODES.map((m) => m.label)).toEqual(['Binary', 'Decimal', 'Hex', 'All'])
  })
})

describe('bit helpers for the clickable bit buttons', () => {
  it('bitsMsbFirst returns the most significant bit first', () => {
    expect(bitsMsbFirst(0b0001, 4)).toEqual([0, 0, 0, 1])
    expect(bitsMsbFirst(0x8001, 16)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(bitsMsbFirst(5, 1)).toEqual([1]) // masked to the width
  })

  it('toggleBit flips one bit and keeps the value inside the width', () => {
    expect(toggleBit(0b0101, 1, 4)).toBe(0b0111)
    expect(toggleBit(0b0111, 0, 4)).toBe(0b0110)
    expect(toggleBit(0, 15, 16)).toBe(0x8000)
    expect(toggleBit(0xffff, 15, 16)).toBe(0x7fff)
    expect(toggleBit(3, 7, 4)).toBe(3) // bit 7 does not exist in a 4-bit value: unchanged
  })

  it('toggling twice gives the original value (both bit buttons and the decimal box stay in sync)', () => {
    for (const v of [0, 1, 0x1234, 0xffff]) for (const b of [0, 5, 15]) expect(toggleBit(toggleBit(v, b, 16), b, 16)).toBe(v)
  })
})
