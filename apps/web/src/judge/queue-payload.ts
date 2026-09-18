import type { CreateAscentInput } from '@climbcontest/contracts'

/**
 * Ce que porte un élément de la file `packages/sync`. Surensemble du contrat
 * réseau `judgeAscentBatchItemInputSchema` : `competitorId`/`routeId` sont
 * ajoutés sur la variante `correct` (absents du contrat serveur, qui résout
 * la cible via `supersedesId`) uniquement pour l'indexation locale — Zod les
 * ignore silencieusement à la désérialisation côté serveur (schéma non
 * strict), donc envoyés tels quels sans transformation.
 */
export type QueuePayload =
  | ({ kind: 'create' } & CreateAscentInput)
  | {
      kind: 'correct'
      id: string
      supersedesId: string
      competitorId: string
      routeId: string
      holdNumber: number | null
      modifier: 'none' | 'plus'
      isTop: boolean
      status: 'valid' | 'dns' | 'dnf'
      climbTimeMs?: number | null | undefined
    }
