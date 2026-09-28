import {
  BACKUP_SCHEMA_VERSION,
  competitionBackupSchema,
  type CompetitionBackup,
} from '@climbcontest/contracts'
import {
  activityLog,
  ascent,
  ascentEvent,
  category,
  competition,
  competitor,
  judge,
  judgeRoute,
  round,
  roundCategory,
  roundQualifier,
  roundRoute,
  route,
  routeCategory,
  type Database,
} from '@climbcontest/db'
import { asc, eq } from 'drizzle-orm'

import { addressOf } from '../address'

type CompetitionRow = typeof competition.$inferSelect

const iso = (date: Date) => date.toISOString()
const isoOrNull = (date: Date | null) => (date ? date.toISOString() : null)

/**
 * Construit la sauvegarde JSON complète d'une compétition (ADR-056). Chaque
 * champ est copié explicitement — aucune ligne n'est jamais sérialisée telle
 * quelle — et le résultat est revalidé par le schéma avant d'être renvoyé : si
 * on ajoute une colonne secrète à une table, elle ne sort pas d'ici.
 *
 * Toutes les lignes sont exportées, y compris supprimées (`deletedAt`) : un
 * passage peut référencer un compétiteur ou une voie retirés, et une
 * restauration ne doit pas les ressusciter.
 */
export async function buildCompetitionBackup(
  db: Database,
  currentCompetition: CompetitionRow,
  exportedAt: Date,
): Promise<CompetitionBackup> {
  const competitionId = currentCompetition.id

  const categories = await db
    .select()
    .from(category)
    .where(eq(category.competitionId, competitionId))
    .orderBy(asc(category.displayOrder))
  const competitors = await db
    .select()
    .from(competitor)
    .where(eq(competitor.competitionId, competitionId))
    .orderBy(asc(competitor.bib), asc(competitor.lastName))
  const routes = await db
    .select()
    .from(route)
    .where(eq(route.competitionId, competitionId))
    .orderBy(asc(route.number))
  const rounds = await db
    .select()
    .from(round)
    .where(eq(round.competitionId, competitionId))
    .orderBy(asc(round.displayOrder))
  const judges = await db.select().from(judge).where(eq(judge.competitionId, competitionId))

  // Jointures plutôt que `inArray(ids)` : une compétition chargée compte des
  // milliers de passages, ce qui ferait exploser le nombre de paramètres.
  const routeCategories = await db
    .select({ routeId: routeCategory.routeId, categoryId: routeCategory.categoryId })
    .from(routeCategory)
    .innerJoin(route, eq(route.id, routeCategory.routeId))
    .where(eq(route.competitionId, competitionId))
  const roundRoutes = await db
    .select({
      roundId: roundRoute.roundId,
      routeId: roundRoute.routeId,
      categoryId: roundRoute.categoryId,
    })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .where(eq(round.competitionId, competitionId))
  // ADR-065 : seuls les couples (tour, catégorie) déjà passés par une
  // transition ont une ligne ; l'absence vaut brouillon, à la relecture aussi.
  const roundCategories = await db
    .select({
      roundId: roundCategory.roundId,
      categoryId: roundCategory.categoryId,
      status: roundCategory.status,
    })
    .from(roundCategory)
    .innerJoin(round, eq(round.id, roundCategory.roundId))
    .where(eq(round.competitionId, competitionId))
  const roundQualifiers = await db
    .select({
      roundId: roundQualifier.roundId,
      categoryId: roundQualifier.categoryId,
      competitorId: roundQualifier.competitorId,
      sourceRoundId: roundQualifier.sourceRoundId,
      sourceRank: roundQualifier.sourceRank,
      frozenAt: roundQualifier.frozenAt,
    })
    .from(roundQualifier)
    .innerJoin(round, eq(round.id, roundQualifier.roundId))
    .where(eq(round.competitionId, competitionId))
  const judgeRoutes = await db
    .select({ judgeId: judgeRoute.judgeId, routeId: judgeRoute.routeId })
    .from(judgeRoute)
    .innerJoin(judge, eq(judge.id, judgeRoute.judgeId))
    .where(eq(judge.competitionId, competitionId))

  const ascents = await db
    .select()
    .from(ascent)
    .where(eq(ascent.competitionId, competitionId))
    .orderBy(asc(ascent.recordedAt), asc(ascent.id))
  const events = await db
    .select({ event: ascentEvent })
    .from(ascentEvent)
    .innerJoin(ascent, eq(ascent.id, ascentEvent.ascentId))
    .where(eq(ascent.competitionId, competitionId))
    .orderBy(asc(ascentEvent.createdAt), asc(ascentEvent.id))
  const activity = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.competitionId, competitionId))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id))

  const routesOfJudge = new Map<string, string[]>()
  for (const link of judgeRoutes) {
    const list = routesOfJudge.get(link.judgeId) ?? []
    list.push(link.routeId)
    routesOfJudge.set(link.judgeId, list)
  }
  const judgeIds = new Set(judges.map((j) => j.id))

  const backup: CompetitionBackup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: iso(exportedAt),
    competition: {
      name: currentCompetition.name,
      venue: currentCompetition.venue,
      address: addressOf(currentCompetition),
      startsOn: currentCompetition.startsOn,
      endsOn: currentCompetition.endsOn,
      discipline: currentCompetition.discipline,
      format: currentCompetition.format as CompetitionBackup['competition']['format'],
      scoringEngineId: currentCompetition.scoringEngineId,
      scoringConfig: currentCompetition.scoringConfig as Record<string, unknown>,
      status: currentCompetition.status as CompetitionBackup['competition']['status'],
      timingEnabled: currentCompetition.timingEnabled,
      judgePinRequired: currentCompetition.judgePinRequired,
      judgeCredentialsStored: currentCompetition.judgeCredentialsStored,
    },
    categories: categories.map((row) => ({
      id: row.id,
      label: row.label,
      sex: row.sex as 'M' | 'F' | 'X',
      birthYearMin: row.birthYearMin,
      birthYearMax: row.birthYearMax,
      displayOrder: row.displayOrder,
      deletedAt: isoOrNull(row.deletedAt),
    })),
    competitors: competitors.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      bib: row.bib,
      firstName: row.firstName,
      lastName: row.lastName,
      birthYear: row.birthYear,
      clubName: row.clubName,
      licenseNumber: row.licenseNumber,
      status: row.status as CompetitionBackup['competitors'][number]['status'],
      deletedAt: isoOrNull(row.deletedAt),
    })),
    routes: routes.map((row) => ({
      id: row.id,
      number: row.number,
      name: row.name,
      holdCount: row.holdCount,
      sector: row.sector,
      color: row.color,
      videoUrl: row.videoUrl,
      notes: row.notes,
      deletedAt: isoOrNull(row.deletedAt),
    })),
    routeCategories,
    rounds: rounds.map((row) => ({
      id: row.id,
      type: row.type as CompetitionBackup['rounds'][number]['type'],
      style: row.style as CompetitionBackup['rounds'][number]['style'],
      displayOrder: row.displayOrder,
      qualifyingCount: row.qualifyingCount,
      deletedAt: isoOrNull(row.deletedAt),
    })),
    roundCategories: roundCategories.map((row) => ({
      roundId: row.roundId,
      categoryId: row.categoryId,
      status: row.status as CompetitionBackup['roundCategories'][number]['status'],
    })),
    roundRoutes,
    roundQualifiers: roundQualifiers.map((row) => ({ ...row, frozenAt: iso(row.frozenAt) })),
    judges: judges.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      routeIds: routesOfJudge.get(row.id) ?? [],
      deletedAt: isoOrNull(row.deletedAt),
    })),
    ascents: ascents.map((row) => ({
      id: row.id,
      roundId: row.roundId,
      routeId: row.routeId,
      competitorId: row.competitorId,
      holdNumber: row.holdNumber,
      holdCount: row.holdCount,
      modifier: row.modifier as 'none' | 'plus',
      isTop: row.isTop,
      status: row.status as CompetitionBackup['ascents'][number]['status'],
      climbTimeMs: row.climbTimeMs,
      recordedBy: row.recordedByJudgeId
        ? { kind: 'judge' as const, judgeId: row.recordedByJudgeId }
        : { kind: 'organizer' as const },
      recordedAt: iso(row.recordedAt),
      syncedAt: iso(row.syncedAt),
      deviceId: row.deviceId,
      supersededBy: row.supersededBy,
      conflictGroup: row.conflictGroup,
      voidedAt: row.voidedAt ? iso(row.voidedAt) : null,
    })),
    ascentEvents: events.map(({ event }) => ({
      id: event.id,
      ascentId: event.ascentId,
      eventType: event.eventType,
      actorType: event.actorType,
      actorJudgeId: event.actorId && judgeIds.has(event.actorId) ? event.actorId : null,
      payload: event.payload,
      reason: event.reason,
      createdAt: iso(event.createdAt),
    })),
    activityLog: activity.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      actorType: row.actorType,
      entityId: row.entityId,
      payload: row.payload,
      reason: row.reason,
      createdAt: iso(row.createdAt),
    })),
  }

  return competitionBackupSchema.parse(backup)
}
