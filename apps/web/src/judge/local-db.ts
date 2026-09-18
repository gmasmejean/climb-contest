import type { JudgeRouteDetail } from '@climbcontest/contracts'
import type { QueueItem } from '@climbcontest/sync'
import Dexie, { type Table } from 'dexie'

import type { QueuePayload } from './queue-payload'

export interface StoredRouteDetail {
  /** Clé primaire — aplati depuis `detail.route.id` (pas de clé composée/imbriquée). */
  routeId: string
  detail: JudgeRouteDetail
}

export interface JudgeMetaRow {
  key: 'judge'
  judgeId: string
  displayName: string
  fetchedAt: string
}

/**
 * La dernière saisie du juge, tous compétiteurs confondus (ADR-007) — un
 * singleton (clé fixe `'current'`), mis à jour à CHAQUE `enqueue()`
 * (création ou correction), indépendamment du cycle de vie de la file
 * (un élément `acked` est retiré de `queue` par `packages/sync`, mais la
 * fenêtre de correction doit rester dérivable après coup).
 */
export interface LastSubmissionRow {
  key: 'current'
  competitorId: string
  ascentId: string
  recordedAt: string
  correctableUntil: string
}

/**
 * Unique source de vérité côté juge (ADR-012, SPEC.md § 6.3) — une seule base
 * par appareil, cohérente avec `judge-session.ts` qui ne garde qu'un seul
 * jeton actif à la fois (DECISIONS.md ADR-036). `resetJudgeDatabase()` la
 * vide intégralement quand un changement de juge est détecté au bootstrap.
 */
export class JudgeDatabase extends Dexie {
  routeDetails!: Table<StoredRouteDetail, string>
  queue!: Table<QueueItem<QueuePayload>, string>
  meta!: Table<JudgeMetaRow, string>
  lastSubmission!: Table<LastSubmissionRow, string>

  constructor() {
    super('climbcontest-judge')
    this.version(1).stores({
      routeDetails: 'routeId',
      queue: 'id',
      meta: 'key',
      lastSubmission: 'key',
    })
  }
}

export const judgeDb = new JudgeDatabase()

export async function resetJudgeDatabase(): Promise<void> {
  await judgeDb.routeDetails.clear()
  await judgeDb.queue.clear()
  await judgeDb.meta.clear()
  await judgeDb.lastSubmission.clear()
}
