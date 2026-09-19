import { z } from 'zod'

import { competitionFormatSchema, competitionStatusSchema } from './competition'
import { roundStatusSchema, roundStyleSchema, roundTypeSchema } from './round'

/**
 * Sauvegarde JSON complète d'une compétition (ROADMAP.md Lot 9, point 2,
 * DECISIONS.md ADR-056). Écrite à la main, PAS dérivée de `createSelectSchema` :
 * c'est une LISTE BLANCHE de colonnes. Un secret ajouté plus tard à une table
 * (jeton, hachage, PIN…) ne peut pas fuir dans l'export par simple omission —
 * il faudrait l'écrire ici. `.strict()` partout : un champ inconnu dans un
 * fichier importé est rejeté, pas silencieusement ignoré.
 */

/** Version du format. À incrémenter à toute évolution non rétrocompatible. */
export const BACKUP_SCHEMA_VERSION = 1

const id = z.uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.')
const isoDateTime = z.iso.datetime()

const ascentStatusSchema = z.enum(['valid', 'dns', 'dnf', 'dsq'])

export const backupCompetitionSchema = z
  .object({
    name: z.string().min(1),
    venue: z.string(),
    startsOn: isoDate,
    endsOn: isoDate,
    discipline: z.string(),
    format: competitionFormatSchema,
    scoringEngineId: z.string().min(1),
    scoringConfig: z.record(z.string(), z.unknown()),
    status: competitionStatusSchema,
    timingEnabled: z.boolean(),
    judgePinRequired: z.boolean(),
    judgeCredentialsStored: z.boolean(),
  })
  .strict()

export const backupCategorySchema = z
  .object({
    id,
    label: z.string().min(1),
    sex: z.enum(['M', 'F', 'X']),
    birthYearMin: z.number().int().nullable(),
    birthYearMax: z.number().int().nullable(),
    displayOrder: z.number().int(),
    deletedAt: isoDateTime.nullable(),
  })
  .strict()

export const backupCompetitorSchema = z
  .object({
    id,
    categoryId: id,
    bib: z.number().int().nullable(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    birthYear: z.number().int().nullable(),
    clubName: z.string().nullable(),
    licenseNumber: z.string().nullable(),
    status: z.enum(['registered', 'present', 'withdrawn', 'disqualified']),
    deletedAt: isoDateTime.nullable(),
  })
  .strict()

export const backupRouteSchema = z
  .object({
    id,
    number: z.number().int(),
    name: z.string().nullable(),
    holdCount: z.number().int().positive(),
    sector: z.string().nullable(),
    color: z.string().nullable(),
    // Lien externe seulement : une vidéo téléversée est un fichier, hors JSON.
    videoUrl: z.string().nullable(),
    notes: z.string().nullable(),
    deletedAt: isoDateTime.nullable(),
  })
  .strict()

export const backupRouteCategorySchema = z.object({ routeId: id, categoryId: id }).strict()

export const backupRoundSchema = z
  .object({
    id,
    type: roundTypeSchema,
    style: roundStyleSchema,
    displayOrder: z.number().int(),
    qualifyingCount: z.number().int().positive().nullable(),
    status: roundStatusSchema,
    deletedAt: isoDateTime.nullable(),
  })
  .strict()

export const backupRoundRouteSchema = z
  .object({ roundId: id, routeId: id, categoryId: id })
  .strict()

export const backupRoundQualifierSchema = z
  .object({
    roundId: id,
    categoryId: id,
    competitorId: id,
    sourceRoundId: id,
    sourceRank: z.number().int().positive(),
    frozenAt: isoDateTime,
  })
  .strict()

/** Sans jeton, PIN ni e-mail : le nom et les voies suffisent à garder l'attribution. */
export const backupJudgeSchema = z
  .object({
    id,
    displayName: z.string().min(1),
    routeIds: z.array(id),
    deletedAt: isoDateTime.nullable(),
  })
  .strict()

export const backupAscentSchema = z
  .object({
    id,
    roundId: id,
    routeId: id,
    competitorId: id,
    holdNumber: z.number().int().nullable(),
    holdCount: z.number().int().positive(),
    modifier: z.enum(['none', 'plus']),
    isTop: z.boolean(),
    status: ascentStatusSchema,
    climbTimeMs: z.number().int().nullable(),
    recordedBy: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('judge'), judgeId: id }).strict(),
      z.object({ kind: z.literal('organizer') }).strict(),
    ]),
    recordedAt: isoDateTime,
    syncedAt: isoDateTime,
    deviceId: z.string(),
    supersededBy: id.nullable(),
    conflictGroup: id.nullable(),
  })
  .strict()

export const backupAscentEventSchema = z
  .object({
    id,
    ascentId: id,
    eventType: z.string(),
    actorType: z.string(),
    // Un juge (remappé à l'import) ; null pour un organisateur ou le système.
    actorJudgeId: id.nullable(),
    payload: z.unknown(),
    reason: z.string().nullable(),
    createdAt: isoDateTime,
  })
  .strict()

export const backupActivityLogSchema = z
  .object({
    id,
    eventType: z.string(),
    actorType: z.string(),
    // round.id ou competitor.id selon `eventType` — remappé à l'import.
    entityId: id,
    payload: z.unknown(),
    reason: z.string().nullable(),
    createdAt: isoDateTime,
  })
  .strict()

export const competitionBackupSchema = z
  .object({
    schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
    exportedAt: isoDateTime,
    competition: backupCompetitionSchema,
    categories: z.array(backupCategorySchema),
    competitors: z.array(backupCompetitorSchema),
    routes: z.array(backupRouteSchema),
    routeCategories: z.array(backupRouteCategorySchema),
    rounds: z.array(backupRoundSchema),
    roundRoutes: z.array(backupRoundRouteSchema),
    roundQualifiers: z.array(backupRoundQualifierSchema),
    judges: z.array(backupJudgeSchema),
    ascents: z.array(backupAscentSchema),
    ascentEvents: z.array(backupAscentEventSchema),
    activityLog: z.array(backupActivityLogSchema),
  })
  .strict()
export type CompetitionBackup = z.infer<typeof competitionBackupSchema>

export const importBackupInputSchema = z.object({
  mode: z.enum(['preview', 'commit']),
  // Validé séparément pour pouvoir répondre en français, ligne par ligne.
  backup: z.unknown(),
})
export type ImportBackupInput = z.infer<typeof importBackupInputSchema>

export const backupPreviewSchema = z.object({
  competitionName: z.string(),
  format: competitionFormatSchema,
  exportedAt: isoDateTime,
  counts: z.object({
    categories: z.number().int(),
    competitors: z.number().int(),
    routes: z.number().int(),
    rounds: z.number().int(),
    judges: z.number().int(),
    ascents: z.number().int(),
  }),
  /** Ce qui ne sera PAS restauré tel quel, dit en clair. */
  notices: z.array(z.string()),
})
export type BackupPreview = z.infer<typeof backupPreviewSchema>

export const importBackupResultSchema = z.object({ competitionId: id })
export type ImportBackupResult = z.infer<typeof importBackupResultSchema>
