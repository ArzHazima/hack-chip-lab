// The .hack parser: one 16-character 0/1 instruction per line.
import { describe, expect, it } from 'vitest'
import { HackParseError, MAX_HACK_LINES, parseHack } from './hack'

const I1 = '0000000000000010'
const I2 = '1110110000010000'

describe('parseHack', () => {
  it('reads valid lines as numbers (MSB first)', () => {
    const r = parseHack(`${I1}\n${I2}\n`)
    expect(r.words).toEqual([2, 0b1110110000010000])
    expect(r.warnings).toEqual([])
  })

  it('accepts Windows line endings, blank lines, spaces around a line and a BOM', () => {
    const r = parseHack(`﻿${I1}\r\n\r\n  ${I2}  \r\n\r\n`)
    expect(r.words).toEqual([2, 0b1110110000010000])
    expect(r.warnings).toEqual([])
  })

  it('warns with the line number for an invalid line and says it was skipped', () => {
    const r = parseHack(`${I1}\n12345\n${I2}\n01010101010101012\n`)
    expect(r.words).toHaveLength(2)
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings[0]).toMatch(/line 2/)
    expect(r.warnings[0]).toMatch(/skipped/i)
    expect(r.warnings[1]).toMatch(/line 4/)
  })

  it('counts line numbers over blank lines too', () => {
    const r = parseHack(`\n\n${I1}\nxx\n`)
    expect(r.warnings[0]).toMatch(/line 4/)
  })

  it('limits the number of warnings for a junk file', () => {
    const r = parseHack('junk\n'.repeat(1000))
    expect(r.words).toEqual([])
    expect(r.warnings.length).toBeLessThanOrEqual(21)
    expect(r.warnings[r.warnings.length - 1]).toMatch(/more/)
  })

  it('an empty file is valid and has no instructions', () => {
    expect(parseHack('').words).toEqual([])
  })

  it('more than 32768 instructions is an error naming the line', () => {
    const text = (I1 + '\n').repeat(MAX_HACK_LINES + 1)
    expect(() => parseHack(text)).toThrow(HackParseError)
    expect(() => parseHack(text)).toThrow(/line 32769/)
    expect(parseHack((I1 + '\n').repeat(MAX_HACK_LINES)).words).toHaveLength(MAX_HACK_LINES)
  })
})
