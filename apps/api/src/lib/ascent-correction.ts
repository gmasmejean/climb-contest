import { ascent, ascentEvent, type Database } from '@climbcontest/db'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import type { AscentActor } from './ascent-write'
import { notifyPublic } from './notify-public'
import { ApiError } from '../middleware/problem'

type AscentRow = typeof ascent.$inferSelect

export interface AscentContent {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  climbTimeMs?: number | null | undefined
}

function actorEventFields(actor: AscentActor) {
  return {
    actorType: actor.kind,
    actorId: actor.kind === 'judge' ? actor.judgeId : actor.userId,
  }
}

function contentSnapshot(row: AscentRow) {
  return {
    holdNumber: row.holdNumber,
    modifier: row.modifier,
    isTop: row.isTop,
    status: row.status,
    climbTimeMs: row.climbTimeMs,
  }
}

/**
 * Chaîne une ou plusieurs lignes sources vers une seule nouvelle ligne
 * gagnante. Couvre deux cas du domaine avec la même mécanique de contrainte
 * différée (DECISIONS.md ADR-031) : une correction simple (`sources.length
 * === 1` — juge ou organisateur) et une résolution de conflit par nouvelle
 * valeur (`sources.length === 2` — organisateur, Lot 8). Toutes les sources
 * doivent partager le même (compétition, tour, voie, compétiteur) : ça reste
 * vrai par construction pour une correction (une seule source) comme pour un
 * groupe de conflit (même triplet, par définition — voir `ascent-write.ts`).
 */
export async function supersedeToNewAscent(
  db: Database,
  params: {
    sources: AscentRow[]
    newId: string
    content: AscentContent
    actor: AscentActor
    categoryId: string
    eventType: 'corrected' | 'conflict_resolved'
    reason: string | null
  },
): Promise<AscentRow> {
  const { sources, newId, content, actor, categoryId, eventType, reason } = params
  const first = sources[0]
  if (!first) throw new ApiError(500, 'Erreur interne', 'Aucune ligne à corriger.')

  return db.transaction(async (tx) => {
    // Ordre obligatoire, comme la correction juge (ADR-031) : chaque source
    // doit sortir de l'index unique actif (`ascent_active_key`, jamais
    // différable — c'est un index partiel) AVANT que la nouvelle ligne n'y
    // entre. Ça ne marche que parce que la FK `superseded_by` est
    // `DEFERRABLE INITIALLY DEFERRED` (migration `0004`) : sans ça, cet
    // `UPDATE` échouerait en référençant `newId`, qui n'existe pas encore —
    // elle n'est vérifiée qu'au COMMIT, une fois l'`INSERT` ci-dessous passé.
    for (const source of sources) {
      await tx
        .update(ascent)
        .set({ supersededBy: newId, conflictGroup: null, updatedAt: new Date() })
        .where(eq(ascent.id, source.id))
    }

    const [row] = await tx
      .insert(ascent)
      .values({
        id: newId,
        competitionId: first.competitionId,
        roundId: first.roundId,
        routeId: first.routeId,
        competitorId: first.competitorId,
        holdNumber: content.holdNumber,
        holdCount: first.holdCount,
        modifier: content.modifier,
        isTop: content.isTop,
        status: content.status,
        climbTimeMs: content.climbTimeMs ?? null,
        recordedByJudgeId: actor.kind === 'judge' ? actor.judgeId : null,
        recordedByUserId: actor.kind === 'organizer' ? actor.userId : null,
        // Une correction rectifie une saisie déjà survenue : l'heure de
        // l'événement ne change pas, seule sa valeur est rectifiée.
        recordedAt: first.recordedAt,
        deviceId: first.deviceId,
      })
      .returning()
    if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer la correction.')

    await tx.insert(ascentEvent).values([
      ...sources.map((source) => ({
        ascentId: source.id,
        eventType,
        ...actorEventFields(actor),
        payload: { supersededBy: row.id, previous: contentSnapshot(source) },
        reason,
      })),
      {
        ascentId: row.id,
        eventType: 'created' as const,
        ...actorEventFields(actor),
        payload: {
          supersededFrom: sources.map((source) => source.id),
          ...contentSnapshot(row),
        },
        reason: null,
      },
    ])

    await notifyPublic(tx, {
      type: 'ranking_updated',
      competitionId: first.competitionId,
      categoryId,
    })

    return row
  })
}

/**
 * Résolution de conflit « on garde une des deux valeurs déjà saisies » — pas
 * de nouvelle ligne : le gagnant sort du conflit (redevient la ligne active
 * du triplet), le(s) perdant(s) sont chaînés dessus.
 */
export async function resolveConflictByChoosing(
  db: Database,
  params: {
    winner: AscentRow
    losers: AscentRow[]
    actor: AscentActor
    categoryId: string
    reason: string | null
  },
): Promise<AscentRow> {
  const { winner, losers, actor, categoryId, reason } = params

  return db.transaction(async (tx) => {
    const [updatedWinner] = await tx
      .update(ascent)
      .set({ conflictGroup: null, updatedAt: new Date() })
      .where(eq(ascent.id, winner.id))
      .returning()
    if (!updatedWinner) throw new ApiError(500, 'Erreur interne', 'Impossible de résoudre le conflit.')

    for (const loser of losers) {
      await tx
        .update(ascent)
        .set({ supersededBy: winner.id, conflictGroup: null, updatedAt: new Date() })
        .where(eq(ascent.id, loser.id))
    }

    await tx.insert(ascentEvent).values([
      ...losers.map((loser) => ({
        ascentId: loser.id,
        eventType: 'conflict_resolved' as const,
        ...actorEventFields(actor),
        payload: { supersededBy: winner.id, previous: contentSnapshot(loser) },
        reason,
      })),
      {
        ascentId: winner.id,
        eventType: 'conflict_resolved' as const,
        ...actorEventFields(actor),
        payload: { kept: true, current: contentSnapshot(updatedWinner) },
        reason,
      },
    ])

    await notifyPublic(tx, {
      type: 'ranking_updated',
      competitionId: winner.competitionId,
      categoryId,
    })

    return updatedWinner
  })
}

/**
 * ADR-078 — correction reçue d'un accès RÉVOQUÉ : elle ne remplace pas la
 * saisie visée, elle se pose en conflit avec elle. Les deux lignes partagent un
 * `conflict_group` neuf et sortent du classement jusqu'à la décision de
 * l'organisateur (écran Conflits habituel, deux valeurs côte à côte).
 */
export async function quarantineCorrection(
  db: Database,
  params: {
    target: AscentRow
    newId: string
    content: AscentContent
    judgeId: string
    categoryId: string
  },
): Promise<{ conflictGroup: string; existing: AscentRow; incoming: AscentRow }> {
  const { target, newId, content, judgeId, categoryId } = params
  const conflictGroup = uuidv7()

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .update(ascent)
      .set({ conflictGroup, updatedAt: new Date() })
      .where(eq(ascent.id, target.id))
      .returning()
    if (!existing) throw new ApiError(500, 'Erreur interne', 'Impossible de relire le passage.')

    const [incoming] = await tx
      .insert(ascent)
      .values({
        id: newId,
        competitionId: target.competitionId,
        roundId: target.roundId,
        routeId: target.routeId,
        competitorId: target.competitorId,
        holdNumber: content.holdNumber,
        holdCount: target.holdCount,
        modifier: content.modifier,
        isTop: content.isTop,
        status: content.status,
        climbTimeMs: content.climbTimeMs ?? null,
        recordedByJudgeId: judgeId,
        recordedByUserId: null,
        recordedAt: target.recordedAt,
        deviceId: target.deviceId,
        conflictGroup,
      })
      .returning()
    if (!incoming) {
      throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer la correction.')
    }

    await tx.insert(ascentEvent).values({
      ascentId: incoming.id,
      eventType: 'created',
      actorType: 'judge',
      actorId: judgeId,
      payload: {
        ...contentSnapshot(incoming),
        conflictGroup,
        correctionOf: target.id,
        quarantine: 'revoked_judge',
      },
      reason: null,
    })

    await notifyPublic(tx, {
      type: 'ranking_updated',
      competitionId: target.competitionId,
      categoryId,
    })

    return { conflictGroup, existing, incoming }
  })
}

/**
 * ADR-078 — l'organisateur REFUSE une saisie en quarantaine (groupe à une seule
 * ligne). La ligne garde son `conflict_group` : elle reste hors de tous les
 * filtres « actif » et de `ascent_active_key`. `voided_at` la retire seulement
 * des lectures de conflits non résolus. Rien n'est supprimé, tout est tracé.
 */
export async function voidQuarantinedAscent(
  db: Database,
  params: { row: AscentRow; actor: AscentActor; reason: string },
): Promise<AscentRow> {
  const { row, actor, reason } = params
  return db.transaction(async (tx) => {
    const [voided] = await tx
      .update(ascent)
      .set({ voidedAt: new Date(), updatedAt: new Date() })
      .where(eq(ascent.id, row.id))
      .returning()
    if (!voided) throw new ApiError(500, 'Erreur interne', 'Impossible de refuser cette saisie.')

    await tx.insert(ascentEvent).values({
      ascentId: row.id,
      eventType: 'voided',
      ...actorEventFields(actor),
      payload: { previous: contentSnapshot(row) },
      reason,
    })
    return voided
  })
}
