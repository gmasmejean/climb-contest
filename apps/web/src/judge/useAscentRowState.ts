import type { CorrectLastAscentInput, CreateAscentInput } from '@climbcontest/contracts'
import { computed, type ComputedRef } from 'vue'

import { correctLastAscent, recordAscent } from './ascent-mutations'
import { isAscentSummary, type AscentSummary } from './conflict-summary'
import { judgeDb } from './local-db'
import { syncEngine } from './sync-runtime'
import { useLiveQuery } from './use-live-query'

export interface AscentRowSyncState {
  status: 'syncing' | 'conflict' | 'rejected'
  reason?: string | undefined
  conflict?: { existing: AscentSummary; incoming: AscentSummary } | undefined
}

/**
 * État de synchronisation par compétiteur, dérivé de la file durable
 * `packages/sync` (Dexie) — remplace le `Map` en mémoire du Lot 5. La
 * DONNÉE du passage (fait/à faire, valeurs) vit désormais directement dans
 * `routeDetails` (écrite de façon optimiste par `ascent-mutations.ts`) ; ce
 * module ne fournit plus que l'état de synchronisation superposé, et la
 * fenêtre de correction (ADR-007, persistée dans `lastSubmission`).
 *
 * Simplification assumée pour ce lot : un `rejected` n'annule pas
 * l'écriture optimiste déjà faite dans `routeDetails` (le compétiteur reste
 * affiché « fait ») — l'avertissement reste visible et permanent tant que
 * le juge ne l'a pas explicitement écarté, plutôt que de faire réapparaître
 * silencieusement la ligne en « à faire ». Voir TODO.md.
 */
export function useAscentRowState(): {
  submitCreate: (competitorId: string, input: CreateAscentInput) => Promise<void>
  submitCorrect: (
    competitorId: string,
    routeId: string,
    supersedesId: string,
    input: CorrectLastAscentInput,
    originalRecordedAt: string,
  ) => Promise<void>
  get: (competitorId: string) => AscentRowSyncState | undefined
  canCorrect: (competitorId: string, nowMs: number) => boolean
  dismissRejected: (competitorId: string) => void
} {
  const queueItems = useLiveQuery(() => judgeDb.queue.toArray(), [])
  const lastSubmission = useLiveQuery(() => judgeDb.lastSubmission.get('current'), undefined)

  const byCompetitorId: ComputedRef<Map<string, (typeof queueItems.value)[number]>> = computed(
    () => new Map(queueItems.value.map((item) => [item.payload.competitorId, item])),
  )

  function submitCreate(_competitorId: string, input: CreateAscentInput): Promise<void> {
    return recordAscent(input)
  }

  function submitCorrect(
    competitorId: string,
    routeId: string,
    supersedesId: string,
    input: CorrectLastAscentInput,
    originalRecordedAt: string,
  ): Promise<void> {
    return correctLastAscent(competitorId, routeId, supersedesId, input, originalRecordedAt)
  }

  function get(competitorId: string): AscentRowSyncState | undefined {
    const item = byCompetitorId.value.get(competitorId)
    if (!item) return undefined
    if (item.state === 'pending' || item.state === 'sending') {
      return { status: 'syncing' }
    }
    if (item.state === 'conflict') {
      const existing = item.conflict?.existing
      const incoming = item.conflict?.incoming
      return {
        status: 'conflict',
        conflict:
          isAscentSummary(existing) && isAscentSummary(incoming)
            ? { existing, incoming }
            : undefined,
      }
    }
    if (item.state === 'rejected') {
      return { status: 'rejected', reason: item.rejectedReason }
    }
    return undefined
  }

  function canCorrect(competitorId: string, nowMs: number): boolean {
    const row = lastSubmission.value
    if (!row) return false
    return row.competitorId === competitorId && nowMs < new Date(row.correctableUntil).getTime()
  }

  function dismissRejected(competitorId: string): void {
    const item = byCompetitorId.value.get(competitorId)
    if (item && item.state === 'rejected') {
      void syncEngine.dismissRejected(item.id)
    }
  }

  return { submitCreate, submitCorrect, get, canCorrect, dismissRejected }
}
