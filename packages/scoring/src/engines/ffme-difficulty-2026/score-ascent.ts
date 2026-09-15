import type { Ascent, Route, ScoreValue } from '../../types'

/**
 * SPEC.md §4.1.
 *
 * `route` plays no part in the calculation: `ascent.holdCount` (ADR-003) is
 * the source of truth, including for an ascent replayed after the route
 * changed. It's kept in the signature to honor the `ScoringEngine`
 * interface (SPEC.md §4.6).
 */
export function scoreAscent(ascent: Ascent, _route: Route): ScoreValue {
  if (ascent.status !== 'valid') {
    return 0
  }

  if (ascent.isTop) {
    return ascent.holdCount + 1
  }

  if (ascent.holdNumber === null) {
    throw new Error(
      'Passage invalide : holdNumber est requis pour un statut "valid" qui n\'est pas un TOP.',
    )
  }

  if (ascent.holdNumber < 1 || ascent.holdNumber > ascent.holdCount) {
    throw new Error(
      `Passage invalide : holdNumber (${String(ascent.holdNumber)}) hors de [1, ${String(ascent.holdCount)}].`,
    )
  }

  return ascent.modifier === 'plus' ? ascent.holdNumber + 0.5 : ascent.holdNumber
}
