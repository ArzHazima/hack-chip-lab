// One place that turns a chip INSTANCE into its definition (pins + behaviour).
// Ordinary chips come from the CHIPS table; Split / Join / Const are built from the
// instance's params. Everything that needs a chip's pins goes through here.

import { busDef, isBusType } from './bus'
import { CHIPS, type ChipDef } from './chips'
import type { ChipInstance } from './circuit'

/** Undefined for an unknown chip type. */
export function chipOf(inst: ChipInstance): ChipDef | undefined {
  if (isBusType(inst.type)) return busDef(inst.type, inst.params ?? { width: 1 })
  return CHIPS[inst.type]
}
