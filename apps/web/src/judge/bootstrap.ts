import type { JudgeBootstrapResponse } from '@climbcontest/contracts'

import { judgeFetch } from '../api/judge-client'
import { judgeDb, resetJudgeDatabase } from './local-db'

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

  return judgeDb.transaction('rw', judgeDb.routeDetails, judgeDb.meta, judgeDb.queue, async () => {
    if (options.onlyIfQueueIdle) {
      const waiting = await judgeDb.queue
        .filter((item) => item.state === 'pending' || item.state === 'sending')
        .count()
      if (waiting > 0) return 'skipped'
    }
    await judgeDb.routeDetails.clear()
    await judgeDb.routeDetails.bulkPut(
      response.routes.map((detail) => ({ routeId: detail.route.id, detail })),
    )
    await judgeDb.meta.put({
      key: 'judge',
      judgeId: response.judge.id,
      displayName: response.judge.displayName,
      fetchedAt: response.fetchedAt,
    })
    return 'written'
  })
}

/** Le bootstrap a-t-il déjà tourné avec succès au moins une fois sur cet appareil ? */
export async function hasBootstrapped(): Promise<boolean> {
  const meta = await judgeDb.meta.get('judge')
  return meta !== undefined
}
