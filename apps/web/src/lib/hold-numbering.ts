import { nextHoldNumber, type RouteHold } from '@climbcontest/contracts'

/** Plus haut numéro de prise placé (0 s'il n'y en a aucun). */
export function highestHoldNumber(holds: readonly RouteHold[]): number {
  return holds.reduce((highest, hold) => Math.max(highest, hold.number), 0)
}

/**
 * Premier numéro libre SOUS le plus haut : la numérotation a un trou (une prise
 * oubliée ou supprimée). `null` quand elle est continue, ou vide.
 */
export function numberingGap(holds: readonly RouteHold[]): number | null {
  const free = nextHoldNumber(holds)
  return free < highestHoldNumber(holds) ? free : null
}
