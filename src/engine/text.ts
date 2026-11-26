// Shared text helper for the .hdl and .tst parsers.

/**
 * Replaces every `/* ... *​/` and `// ...` comment with a space. Single linear pass: the earlier
 * regex `/\*[\s\S]*?\*\/` rescanned to the end of the text for each unterminated `/*`, which is
 * quadratic on adversarial input. A `/*` with no closing `*​/` is left as-is (like before).
 */
export function stripComments(text: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const open = text.indexOf('/*', pos)
    if (open < 0) break
    const close = text.indexOf('*/', open + 2)
    if (close < 0) break // no closer anywhere after this point, so no later comment can close either
    out += text.slice(pos, open) + ' '
    pos = close + 2
  }
  out += text.slice(pos)
  return out.replace(/\/\/[^\n]*/g, ' ')
}
