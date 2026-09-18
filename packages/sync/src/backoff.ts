import type { Clock } from './types'

export interface BackoffOptions {
  baseMs?: number
  capMs?: number
}

const DEFAULT_BASE_MS = 1000
const DEFAULT_CAP_MS = 30_000

/**
 * Repli exponentiel avec « full jitter » (formule AWS) : évite l'effet de
 * horde d'une salle où plusieurs juges reconnectent sur le même wifi au même
 * instant. `attempt` est le nombre de tentatives déjà échouées (0 avant la
 * première).
 */
export function computeBackoffDelayMs(
  attempt: number,
  clock: Pick<Clock, 'random'>,
  options: BackoffOptions = {},
): number {
  const base = options.baseMs ?? DEFAULT_BASE_MS
  const cap = options.capMs ?? DEFAULT_CAP_MS
  const upperBound = Math.min(cap, base * 2 ** attempt)
  return Math.floor(clock.random() * upperBound)
}
