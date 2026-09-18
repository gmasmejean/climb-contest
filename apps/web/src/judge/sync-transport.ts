import type { JudgeAscentsBatchResponse } from '@climbcontest/contracts'
import type { BatchResultItem, QueueItem, SyncTransport } from '@climbcontest/sync'

import { judgeFetch } from '../api/judge-client'
import { toAscentSummary } from './conflict-summary'
import type { QueuePayload } from './queue-payload'

/**
 * Implémentation réseau de `SyncTransport` (packages/sync). Toute exception
 * (réseau coupé, timeout, 401, 5xx…) remonte telle quelle — `SyncEngine` la
 * traite comme « aucune réponse pour aucun élément » et remet tout en
 * `pending` avec repli exponentiel (SPEC.md § 6.3).
 */
export class HttpSyncTransport implements SyncTransport<QueuePayload> {
  async sendBatch(items: QueueItem<QueuePayload>[]): Promise<BatchResultItem[]> {
    const response = await judgeFetch<JudgeAscentsBatchResponse>('/ascents/batch', {
      method: 'POST',
      body: JSON.stringify({ items: items.map((item) => item.payload) }),
    })
    // `existing`/`incoming` sont réduits ICI à leur forme affichable
    // (SPEC.md § 6.3 : « l'affiche au juge avec les deux valeurs ») — c'est
    // le dernier endroit du pipeline où leur type précis (`Ascent`) est
    // encore connu ; `packages/sync` les porte ensuite en `unknown`.
    return response.results.map((result) =>
      result.status === 'conflict'
        ? {
            id: result.id,
            status: 'conflict',
            conflictGroup: result.conflictGroup,
            existing: toAscentSummary(result.existing),
            incoming: toAscentSummary(result.incoming),
          }
        : result,
    )
  }
}
