import type { JudgeBootstrapResponse, JudgeRouteDetail } from '@climbcontest/contracts'
import type { QueueItem } from '@climbcontest/sync'

import { judgeFetch } from '../api/judge-client'
import { judgeDb, resetJudgeDatabase } from './local-db'
import type { QueuePayload } from './queue-payload'
import { syncRoutePhotos } from './route-photos'

/**
 * Après une actualisation, une saisie locale en `conflict` ou `rejected` doit
 * rester « faite » et garder son avertissement (ADR-055). Le serveur, lui,
 * n'a aucun passage ACTIF pour un conflit (les deux lignes sont hors du
 * classement tant que l'organisateur n'a pas tranché) : sans cette
 * conservation, le compétiteur repasserait en « À faire », sans aucun message,
 * et le juge pourrait le ressaisir sans savoir qu'un conflit existe.
 *
 * Ne conserve que pour le MÊME tour : une voie qui passe à un nouveau tour
 * repart de la vérité du serveur. Pure, testée sans base.
 */
export function preserveHeldAscents(
  previous: readonly JudgeRouteDetail[],
  fresh: readonly JudgeRouteDetail[],
  held: readonly QueueItem<QueuePayload>[],
): JudgeRouteDetail[] {
  return fresh.map((detail) => {
    const before = previous.find((p) => p.route.id === detail.route.id)
    if (!before || !detail.round || before.round?.id !== detail.round.id) return detail
    const competitors = detail.competitors.map((competitor) => {
      if (competitor.ascent !== null) return competitor
      const isHeld = held.some(
        (item) =>
          item.payload.routeId === detail.route.id && item.payload.competitorId === competitor.id,
      )
      const kept = isHeld ? before.competitors.find((c) => c.id === competitor.id)?.ascent : null
      return kept ? { ...competitor, ascent: kept } : competitor
    })
    return { ...detail, competitors }
  })
}

export interface BootstrapOptions {
  /**
   * ADR-055 : n'écrit que si aucun élément de la file n'attend encore le
   * serveur (`pending` ou `sending`). Vérifié DANS la transaction d'écriture,
   * pas avant le téléchargement : une saisie enregistrée pendant le
   * téléchargement fait renoncer à l'écriture, une saisie qui arrive après
   * attend la fin de la transaction et s'applique sur les données fraîches.
   */
  onlyIfQueueIdle?: boolean
}

/**
 * `GET /judge/bootstrap` (SPEC.md § 6.3) : appel unique et gros, déclenché au
 * moment où le juge a encore du réseau. Persiste tout dans IndexedDB — plus
 * aucun écran juge ne dépend ensuite du réseau pour s'afficher (CLAUDE.md).
 * Si le juge authentifié a changé depuis le dernier bootstrap connu sur cet
 * appareil, la base est vidée avant d'écrire le nouveau contenu (ADR-036).
 *
 * Renvoie `'skipped'` uniquement avec `onlyIfQueueIdle`, quand la file n'était
 * pas vide au moment d'écrire ou que le cache appartient à un autre juge ;
 * `'written'` sinon.
 */
export async function bootstrapJudge(
  options: BootstrapOptions = {},
): Promise<'written' | 'skipped'> {
  const response = await judgeFetch<JudgeBootstrapResponse>('/bootstrap')

  const existingMeta = await judgeDb.meta.get('judge')
  if (existingMeta && existingMeta.judgeId !== response.judge.id) {
    // Une actualisation automatique ne vide JAMAIS la base : elle détruirait
    // la file d'un autre juge encore non envoyée. Seule une connexion
    // explicite (ADR-036) change de juge.
    if (options.onlyIfQueueIdle) return 'skipped'
    await resetJudgeDatabase()
  }

  const outcome = await judgeDb.transaction(
    'rw',
    judgeDb.routeDetails,
    judgeDb.meta,
    judgeDb.queue,
    async () => {
      if (options.onlyIfQueueIdle) {
        const waiting = await judgeDb.queue
          .filter((item) => item.state === 'pending' || item.state === 'sending')
          .count()
        if (waiting > 0) return 'skipped'
      }
      let routes = response.routes
      if (options.onlyIfQueueIdle) {
        const previous = (await judgeDb.routeDetails.toArray()).map((row) => row.detail)
        const held = await judgeDb.queue
          .filter((item) => item.state === 'conflict' || item.state === 'rejected')
          .toArray()
        routes = preserveHeldAscents(previous, response.routes, held)
      }
      await judgeDb.routeDetails.clear()
      await judgeDb.routeDetails.bulkPut(
        routes.map((detail) => ({ routeId: detail.route.id, detail })),
      )
      await judgeDb.meta.put({
        key: 'judge',
        judgeId: response.judge.id,
        displayName: response.judge.displayName,
        fetchedAt: response.fetchedAt,
      })
      return 'written'
    },
  )

  // Les photos de voie (ADR-066) se téléchargent en arrière-plan, HORS de la
  // transaction (un téléchargement ne doit pas la garder ouverte) et sans faire
  // attendre le juge : ses voies sont déjà utilisables, la photo arrive après.
  if (outcome === 'written') {
    syncRoutePhotos(response.routes).catch(() => {
      // Jamais bloquant : réessayé à la prochaine actualisation.
    })
  }
  return outcome
}

/** Le bootstrap a-t-il déjà tourné avec succès au moins une fois sur cet appareil ? */
export async function hasBootstrapped(): Promise<boolean> {
  const meta = await judgeDb.meta.get('judge')
  return meta !== undefined
}
