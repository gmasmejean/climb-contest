import {
  ascent,
  ascentEvent,
  competitor,
  roundRoute,
  route,
  type Database,
} from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import { notifyPublic } from './notify-public'
import { isUniqueViolation } from './pg-errors'
import { findRoundOpenForCategory } from './round-category'
import { assertCompetitorQualifiedForRound } from './round-qualifiers'
import { ApiError } from '../middleware/problem'

export type AscentActor = { kind: 'judge'; judgeId: string } | { kind: 'organizer'; userId: string }

type AscentRow = typeof ascent.$inferSelect
type RouteRow = typeof route.$inferSelect

export interface AscentWriteItem {
  id: string
  roundId: string
  routeId: string
  competitorId: string
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  climbTimeMs?: number | null | undefined
  recordedAt: string
  deviceId: string
}

/** Un rejeu sûr (retry après coupure) doit porter EXACTEMENT le même contenu. */
export function ascentContentMatches(row: AscentRow, item: AscentWriteItem): boolean {
  return (
    row.roundId === item.roundId &&
    row.routeId === item.routeId &&
    row.competitorId === item.competitorId &&
    row.holdNumber === item.holdNumber &&
    row.modifier === item.modifier &&
    row.isTop === item.isTop &&
    row.status === item.status &&
    row.climbTimeMs === (item.climbTimeMs ?? null)
  )
}

export type AscentWriteResult =
  | { status: 'duplicate'; ascent: AscentRow }
  | { status: 'accepted'; ascent: AscentRow }
  | { status: 'conflict'; conflictGroup: string; existing: AscentRow; incoming: AscentRow }

function actorColumns(actor: AscentActor) {
  return {
    recordedByJudgeId: actor.kind === 'judge' ? actor.judgeId : null,
    recordedByUserId: actor.kind === 'organizer' ? actor.userId : null,
  }
}

function actorEventFields(actor: AscentActor) {
  return {
    actorType: actor.kind,
    actorId: actor.kind === 'judge' ? actor.judgeId : actor.userId,
  }
}

/**
 * Crée un passage en détectant un conflit avec une saisie active concurrente
 * pour le même (tour, voie, compétiteur) — extrait de `routes/judge-ascents.ts`
 * (Lot 6, ADR-033) pour être partagé avec la saisie de secours organisateur
 * (Lot 8) : les deux doivent détecter un conflit exactement de la même façon
 * (un juge et l'organisateur qui saisissent le même passage en même temps ne
 * sont pas un cas différent d'un conflit entre deux juges).
 *
 * `retriesLeft` : `SELECT ... FOR UPDATE` ne verrouille rien tant qu'aucune
 * ligne n'existe pour le triplet — deux écritures concurrentes insérant
 * chacune le tout premier passage peuvent passer la vérification en même
 * temps et se disputer l'index partiel `ascent_active_key` à l'`INSERT`. Pas
 * une erreur : exactement le conflit à détecter, révélé un instant plus tard
 * qu'espéré — on rejoue une fois pour laisser le `SELECT` retrouver la ligne
 * désormais commitée par l'autre transaction (DECISIONS.md ADR-033).
 */
export async function createAscentOrConflict(
  db: Database,
  actor: AscentActor,
  item: AscentWriteItem,
  routeRow: RouteRow,
  competitionId: string,
  retriesLeft = 1,
): Promise<AscentWriteResult> {
  if (item.status === 'valid' && !item.isTop) {
    if (item.holdNumber === null || item.holdNumber > routeRow.holdCount) {
      throw new ApiError(
        400,
        'Prise invalide',
        `Le numéro de prise doit être compris entre 1 et ${routeRow.holdCount}.`,
      )
    }
  }

  const existingById = await db.query.ascent.findFirst({ where: eq(ascent.id, item.id) })
  if (existingById) {
    if (ascentContentMatches(existingById, item)) {
      return { status: 'duplicate', ascent: existingById }
    }
    throw new ApiError(
      409,
      'Identifiant déjà utilisé',
      'Cet identifiant de passage est déjà utilisé pour un autre passage.',
    )
  }

  const competitorRow = await db.query.competitor.findFirst({
    where: and(
      eq(competitor.id, item.competitorId),
      eq(competitor.competitionId, competitionId),
      isNull(competitor.deletedAt),
    ),
  })
  if (!competitorRow) {
    throw new ApiError(404, 'Compétiteur introuvable', "Ce compétiteur n'existe pas.")
  }

  const liveTriple = await db.query.roundRoute.findFirst({
    where: and(
      eq(roundRoute.roundId, item.roundId),
      eq(roundRoute.routeId, item.routeId),
      eq(roundRoute.categoryId, competitorRow.categoryId),
    ),
  })
  const openRoundRow = liveTriple
    ? await findRoundOpenForCategory(db, competitionId, item.roundId, competitorRow.categoryId)
    : undefined
  if (!liveTriple || !openRoundRow) {
    throw new ApiError(404, 'Tour introuvable', "Ce tour n'est pas ouvert pour cette voie.")
  }
  // ADR-054 : commun à la saisie juge (lot) et à la saisie de secours
  // organisateur — un compétiteur hors de la liste figée du tour est refusé,
  // avec un motif lisible (`rejected` côté lot, 409 sinon).
  await assertCompetitorQualifiedForRound(db, item.roundId, competitorRow)

  try {
    return await insertAscentTx(db, actor, item, routeRow, competitionId, competitorRow.categoryId)
  } catch (error) {
    if (isUniqueViolation(error) && retriesLeft > 0) {
      return createAscentOrConflict(db, actor, item, routeRow, competitionId, retriesLeft - 1)
    }
    throw error
  }
}

async function insertAscentTx(
  db: Database,
  actor: AscentActor,
  item: AscentWriteItem,
  routeRow: RouteRow,
  competitionId: string,
  categoryId: string,
): Promise<AscentWriteResult> {
  return db.transaction(async (tx) => {
    // Verrouille la ligne active du triplet, s'il y en a une, pour se
    // protéger d'une course entre deux écritures concurrentes.
    const [activeRow] = await tx
      .select()
      .from(ascent)
      .where(
        and(
          eq(ascent.roundId, item.roundId),
          eq(ascent.routeId, item.routeId),
          eq(ascent.competitorId, item.competitorId),
          isNull(ascent.supersededBy),
          isNull(ascent.conflictGroup),
        ),
      )
      .for('update')

    if (activeRow) {
      if (ascentContentMatches(activeRow, item)) {
        // Même résultat déjà enregistré sous un autre id — rien à ajouter,
        // pas un conflit au sens de SPEC.md § 6.3.
        return { status: 'duplicate', ascent: activeRow }
      }

      // Conflit réel (cas SPEC.md #22). `conflict_group` ne porte aucune FK
      // (contrairement à `superseded_by`) — pas de contournement `DEFERRABLE`
      // nécessaire : l'UPDATE puis l'INSERT s'exécutent dans l'ordre naturel
      // (DECISIONS.md ADR-033).
      const conflictGroupId = uuidv7()
      await tx
        .update(ascent)
        .set({ conflictGroup: conflictGroupId, updatedAt: new Date() })
        .where(eq(ascent.id, activeRow.id))

      const [inserted] = await tx
        .insert(ascent)
        .values({
          id: item.id,
          competitionId,
          roundId: item.roundId,
          routeId: item.routeId,
          competitorId: item.competitorId,
          holdNumber: item.holdNumber,
          holdCount: routeRow.holdCount,
          modifier: item.modifier,
          isTop: item.isTop,
          status: item.status,
          climbTimeMs: item.climbTimeMs ?? null,
          ...actorColumns(actor),
          recordedAt: new Date(item.recordedAt),
          deviceId: item.deviceId,
          conflictGroup: conflictGroupId,
        })
        .returning()
      if (!inserted)
        throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer le passage.')

      await tx.insert(ascentEvent).values({
        ascentId: inserted.id,
        eventType: 'created',
        ...actorEventFields(actor),
        payload: {
          holdNumber: inserted.holdNumber,
          modifier: inserted.modifier,
          isTop: inserted.isTop,
          status: inserted.status,
          climbTimeMs: inserted.climbTimeMs,
          conflictGroup: conflictGroupId,
        },
      })

      const refreshedExisting = await tx.query.ascent.findFirst({
        where: eq(ascent.id, activeRow.id),
      })
      if (!refreshedExisting) {
        throw new ApiError(500, 'Erreur interne', 'Impossible de relire le passage en conflit.')
      }

      await notifyPublic(tx, { type: 'ranking_updated', competitionId, categoryId })

      return {
        status: 'conflict',
        conflictGroup: conflictGroupId,
        existing: refreshedExisting,
        incoming: inserted,
      }
    }

    const [row] = await tx
      .insert(ascent)
      .values({
        id: item.id,
        competitionId,
        roundId: item.roundId,
        routeId: item.routeId,
        competitorId: item.competitorId,
        holdNumber: item.holdNumber,
        holdCount: routeRow.holdCount,
        modifier: item.modifier,
        isTop: item.isTop,
        status: item.status,
        climbTimeMs: item.climbTimeMs ?? null,
        ...actorColumns(actor),
        recordedAt: new Date(item.recordedAt),
        deviceId: item.deviceId,
      })
      .returning()
    if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible d’enregistrer le passage.')

    await tx.insert(ascentEvent).values({
      ascentId: row.id,
      eventType: 'created',
      ...actorEventFields(actor),
      payload: {
        holdNumber: row.holdNumber,
        modifier: row.modifier,
        isTop: row.isTop,
        status: row.status,
        climbTimeMs: row.climbTimeMs,
      },
    })

    await notifyPublic(tx, { type: 'ranking_updated', competitionId, categoryId })

    return { status: 'accepted', ascent: row }
  })
}
