import type { JudgeRouteDetail } from '@climbcontest/contracts'
import type { QueueItem } from '@climbcontest/sync'

import type { QueuePayload } from './queue-payload'

/**
 * Une saisie de la file, écrite en clair pour un humain (Lot 21, ADR-078 et
 * ADR-079) : ce que lit l'organisateur sur le téléphone d'un juge quand une
 * saisie ne peut plus partir toute seule. Pur — les noms viennent du cache
 * local (`routeDetails`), jamais du réseau.
 */
export interface QueueItemDescription {
  id: string
  competitor: string
  route: string
  value: string
  state: QueueItem<QueuePayload>['state']
  reason: string | null
}

export function describeAscentValue(payload: {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
}): string {
  if (payload.status === 'dns') return 'DNS'
  if (payload.status === 'dnf') return 'DNF'
  if (payload.status === 'dsq') return 'DSQ'
  if (payload.isTop) return 'TOP'
  return `prise ${payload.holdNumber ?? '?'}${payload.modifier === 'plus' ? '+' : ''}`
}

export function describeQueueItems(
  items: QueueItem<QueuePayload>[],
  routeDetails: JudgeRouteDetail[],
): QueueItemDescription[] {
  const detailByRoute = new Map(routeDetails.map((detail) => [detail.route.id, detail]))

  return [...items]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((item) => {
      const detail = detailByRoute.get(item.payload.routeId)
      const competitor = detail?.competitors.find((c) => c.id === item.payload.competitorId)
      return {
        id: item.id,
        // Le cache local peut avoir été actualisé depuis la saisie : on le dit
        // plutôt que d'inventer un nom.
        competitor: competitor
          ? `${competitor.bib !== null ? `Dossard ${competitor.bib} — ` : ''}${competitor.firstName} ${competitor.lastName}`
          : 'Compétiteur inconnu de ce téléphone',
        route: detail
          ? `Voie ${detail.route.number}${detail.route.name ? ` — ${detail.route.name}` : ''}`
          : 'Voie inconnue de ce téléphone',
        value: `${describeAscentValue(item.payload)}${item.kind === 'correct' ? ' (correction)' : ''}`,
        state: item.state,
        reason: item.state === 'rejected' ? (item.rejectedReason ?? null) : null,
      }
    })
}
