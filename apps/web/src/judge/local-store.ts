import type { JudgeRouteDetail, JudgeRoutesResponse } from '@climbcontest/contracts'
import type { Ref } from 'vue'

import { judgeDb } from './local-db'
import { useLiveQuery } from './use-live-query'

/**
 * La liste des voies du juge (écran d'accueil), dérivée du cache local —
 * remplace `GET /judge/routes` (ADR-012, SPEC.md § 6.3). La progression est
 * recalculée à partir des compétiteurs déjà connus, elle n'a plus besoin
 * d'être portée par un champ serveur séparé.
 */
export function useJudgeRoutesList(): Ref<JudgeRoutesResponse> {
  return useLiveQuery(async (): Promise<JudgeRoutesResponse> => {
    const stored = await judgeDb.routeDetails.toArray()
    return stored
      .map(({ detail }) => ({
        id: detail.route.id,
        number: detail.route.number,
        name: detail.route.name,
        holdCount: detail.route.holdCount,
        categories: detail.route.categories,
        progress:
          detail.round === null
            ? null
            : {
                done: detail.competitors.filter((competitor) => competitor.ascent !== null).length,
                expected: detail.competitors.length,
              },
      }))
      .sort((a, b) => a.number - b.number)
  }, [])
}

/** Le détail d'une voie (écran voie / saisie), dérivé du cache local. */
export function useJudgeRouteDetail(routeId: string): Ref<JudgeRouteDetail | null> {
  return useLiveQuery(async (): Promise<JudgeRouteDetail | null> => {
    const stored = await judgeDb.routeDetails.get(routeId)
    return stored?.detail ?? null
  }, null)
}
