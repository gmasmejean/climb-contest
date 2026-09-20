import type { JudgeRouteDetail } from '@climbcontest/contracts'

import { judgeFetchBytes, type JudgeFile } from '../api/judge-client'
import { judgeDb } from './local-db'

export interface RoutePhotoSyncDeps {
  fetchPhoto: (routeId: string) => Promise<JudgeFile>
}

const defaultDeps: RoutePhotoSyncDeps = {
  fetchPhoto: (routeId) => judgeFetchBytes(`/routes/${routeId}/photo`),
}

/**
 * Met les photos de voie du juge en accord avec le dernier amorçage (ADR-066) :
 * télécharge celles dont l'identifiant d'image a changé (ou qu'on n'a jamais eues),
 * supprime celles qui ne sont plus annoncées. Une photo déjà à jour n'est jamais
 * retéléchargée.
 *
 * Ne lève JAMAIS : la photo est un plus, pas un préalable à la saisie. Un échec
 * réseau laisse la voie sans photo locale, et la prochaine actualisation
 * (`refresh-routes.ts`) réessaie. Renvoie le nombre de photos téléchargées.
 */
export async function syncRoutePhotos(
  routes: readonly JudgeRouteDetail[],
  deps: RoutePhotoSyncDeps = defaultDeps,
): Promise<number> {
  const announced = new Map<string, string>()
  for (const { route } of routes) {
    if (route.photo) announced.set(route.id, route.photo.assetId)
  }

  const stored = await judgeDb.routePhotos.toArray()
  const storedById = new Map(stored.map((row) => [row.routeId, row]))

  // Plus annoncée, ou remplacée par une autre image : on retire l'ancienne. Une
  // photo remplacée qu'on n'arrive pas à retélécharger ne doit pas s'afficher
  // (elle ne correspond plus aux numéros de prises annoncés).
  const obsolete = stored
    .filter((row) => announced.get(row.routeId) !== row.assetId)
    .map((row) => row.routeId)
  if (obsolete.length > 0) await judgeDb.routePhotos.bulkDelete(obsolete)

  let downloaded = 0
  for (const [routeId, assetId] of announced) {
    if (storedById.get(routeId)?.assetId === assetId) continue
    try {
      const file = await deps.fetchPhoto(routeId)
      await judgeDb.routePhotos.put({
        routeId,
        assetId,
        mimeType: file.mimeType,
        bytes: file.bytes,
      })
      downloaded += 1
    } catch {
      // Réessayé à la prochaine actualisation.
    }
  }
  return downloaded
}
