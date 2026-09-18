import type { CorrectLastAscentInput, CreateAscentInput } from '@climbcontest/contracts'

import { judgeDb, type StoredRouteDetail } from './local-db'
import { syncEngine } from './sync-runtime'

/** ADR-007 : fenêtre de correction du juge — 5 minutes après la saisie initiale. */
const CORRECTION_WINDOW_MS = 5 * 60 * 1000

async function writeOptimisticAscent(
  routeId: string,
  competitorId: string,
  ascent: StoredRouteDetail['detail']['competitors'][number]['ascent'],
): Promise<void> {
  const stored = await judgeDb.routeDetails.get(routeId)
  if (!stored) return // le bootstrap n'a pas (encore) chargé cette voie — rien à mettre à jour
  const competitors = stored.detail.competitors.map((competitor) =>
    competitor.id === competitorId ? { ...competitor, ascent } : competitor,
  )
  await judgeDb.routeDetails.put({ routeId, detail: { ...stored.detail, competitors } })
}

async function writeLastSubmission(
  competitorId: string,
  ascentId: string,
  recordedAt: string,
): Promise<void> {
  const correctableUntil = new Date(
    new Date(recordedAt).getTime() + CORRECTION_WINDOW_MS,
  ).toISOString()
  await judgeDb.lastSubmission.put({
    key: 'current',
    competitorId,
    ascentId,
    recordedAt,
    correctableUntil,
  })
}

/**
 * Point de passage unique de toute mutation de saisie juge (ROADMAP.md
 * Lot 5 : « mutations passant par une seule fonction »). Depuis le Lot 6 :
 * écrit l'état optimiste dans IndexedDB puis enfile dans `packages/sync`
 * — plus aucun appel réseau direct ici (SPEC.md § 6.3, ADR-012). Résout dès
 * que l'écriture locale est durcie, jamais en attendant une réponse serveur.
 */
export async function recordAscent(input: CreateAscentInput): Promise<void> {
  await writeOptimisticAscent(input.routeId, input.competitorId, {
    id: input.id,
    holdNumber: input.holdNumber,
    modifier: input.modifier,
    isTop: input.isTop,
    status: input.status,
    climbTimeMs: input.climbTimeMs ?? null,
    recordedAt: input.recordedAt,
  })
  await writeLastSubmission(input.competitorId, input.id, input.recordedAt)
  await syncEngine.enqueue('create', { kind: 'create', ...input }, input.id)
}

/**
 * `routeId`/`supersedesId` : ajoutés au Lot 6 — le client connaît déjà
 * l'`ascent.id` qu'il corrige (visible dans Dexie), le fournir explicitement
 * évite au serveur de devoir résoudre « la dernière saisie active » en mode
 * lot, ambigu dès que plusieurs compétiteurs sont en jeu (DECISIONS.md
 * ADR-032).
 */
export async function correctLastAscent(
  competitorId: string,
  routeId: string,
  supersedesId: string,
  input: CorrectLastAscentInput,
  originalRecordedAt: string,
): Promise<void> {
  await writeOptimisticAscent(routeId, competitorId, {
    id: input.id,
    holdNumber: input.holdNumber,
    modifier: input.modifier,
    isTop: input.isTop,
    status: input.status,
    climbTimeMs: input.climbTimeMs ?? null,
    recordedAt: originalRecordedAt,
  })
  await writeLastSubmission(competitorId, input.id, originalRecordedAt)
  await syncEngine.enqueue(
    'correct',
    {
      kind: 'correct',
      id: input.id,
      supersedesId,
      competitorId,
      routeId,
      holdNumber: input.holdNumber,
      modifier: input.modifier,
      isTop: input.isTop,
      status: input.status,
      climbTimeMs: input.climbTimeMs ?? null,
    },
    input.id,
  )
}
