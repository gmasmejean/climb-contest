import type { JudgeBootstrapResponse } from '@climbcontest/contracts'

import { judgeFetch } from '../api/judge-client'
import { judgeDb, resetJudgeDatabase } from './local-db'

/**
 * `GET /judge/bootstrap` (SPEC.md § 6.3) : appel unique et gros, déclenché au
 * moment où le juge a encore du réseau. Persiste tout dans IndexedDB — plus
 * aucun écran juge ne dépend ensuite du réseau pour s'afficher (CLAUDE.md).
 * Si le juge authentifié a changé depuis le dernier bootstrap connu sur cet
 * appareil, la base est vidée avant d'écrire le nouveau contenu (ADR-036).
 */
export async function bootstrapJudge(): Promise<void> {
  const response = await judgeFetch<JudgeBootstrapResponse>('/bootstrap')

  const existingMeta = await judgeDb.meta.get('judge')
  if (existingMeta && existingMeta.judgeId !== response.judge.id) {
    await resetJudgeDatabase()
  }

  await judgeDb.transaction('rw', judgeDb.routeDetails, judgeDb.meta, async () => {
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
  })
}

/** Le bootstrap a-t-il déjà tourné avec succès au moins une fois sur cet appareil ? */
export async function hasBootstrapped(): Promise<boolean> {
  const meta = await judgeDb.meta.get('judge')
  return meta !== undefined
}
