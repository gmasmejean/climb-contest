import { ApiError } from '../api/client'
import { markJudgeAccessRevoked } from './access-state'
import { bootstrapJudge } from './bootstrap'

export type RefreshOutcome =
  | 'refreshed'
  | 'waiting-for-queue'
  | 'no-session'
  | 'failed'
  // ADR-078 : le serveur vient de dire que cet accès est révoqué.
  | 'revoked'

export interface RefreshDeps {
  hasJudgeSession: () => boolean
  bootstrap: typeof bootstrapJudge
}

/**
 * ADR-055 : actualise les voies du juge (nouveau tour ouvert, compétiteurs
 * ajoutés…) sans jamais écraser une saisie en attente. Ne lève jamais : un
 * échec réseau est un état normal en salle, pas une erreur à montrer.
 */
export async function refreshRoutesIfQueueIdle(deps: RefreshDeps): Promise<RefreshOutcome> {
  if (!deps.hasJudgeSession()) return 'no-session'
  try {
    const result = await deps.bootstrap({ onlyIfQueueIdle: true })
    return result === 'written' ? 'refreshed' : 'waiting-for-queue'
  } catch (error) {
    // ADR-078 : seul point de contact d'un juge révoqué dont la file est vide.
    if (error instanceof ApiError && error.code === 'judge_revoked') {
      markJudgeAccessRevoked()
      return 'revoked'
    }
    return 'failed'
  }
}

/** Intervalle minimal entre deux actualisations AUTOMATIQUES (le bootstrap est gros). */
export const MIN_AUTO_REFRESH_INTERVAL_MS = 30_000

/**
 * Planificateur des actualisations automatiques : mémorise qu'une
 * actualisation est souhaitée, la tente quand un déclencheur survient ou que
 * la file se vide, et respecte l'intervalle minimal. Pur (horloge et
 * actualisation injectées) pour être testé sans navigateur.
 */
export function createRefreshScheduler(deps: {
  now: () => number
  refresh: () => Promise<RefreshOutcome>
}): { request: () => Promise<void>; onQueueIdle: () => Promise<void> } {
  let wanted = false
  let running = false
  let lastAttemptAt = Number.NEGATIVE_INFINITY

  async function attempt(): Promise<void> {
    if (!wanted || running) return
    if (deps.now() - lastAttemptAt < MIN_AUTO_REFRESH_INTERVAL_MS) return
    running = true
    lastAttemptAt = deps.now()
    try {
      const outcome = await deps.refresh()
      // Seule une file non vide justifie de retenter plus tard : les autres
      // issues (réussite, pas de session, réseau absent) attendent le
      // prochain déclencheur.
      wanted = outcome === 'waiting-for-queue'
    } finally {
      running = false
    }
  }

  return {
    request: () => {
      wanted = true
      return attempt()
    },
    // La file vient de se vider : si une actualisation était en attente, on
    // la fait sans respecter l'intervalle minimal (elle n'a pas pu avoir lieu).
    onQueueIdle: () => {
      if (wanted) lastAttemptAt = Number.NEGATIVE_INFINITY
      return attempt()
    },
  }
}
