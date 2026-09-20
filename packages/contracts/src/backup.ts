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

/**
 * Version du format. À incrémenter à toute évolution non rétrocompatible.
 * 2 (ADR-065) : le statut d'un tour se porte par catégorie (`roundCategories`),
 * plus par tour. La version 1 reste lisible : `parseCompetitionBackup` la remonte.
 */
export const BACKUP_SCHEMA_VERSION = 2
/** Versions que l'import sait lire (la dernière est celle qu'on écrit). */
export const READABLE_BACKUP_SCHEMA_VERSIONS = [1, 2] as const

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
    deletedAt: isoDateTime.nullable(),
  })
  .strict()

/** ADR-065 : ligne absente = brouillon, donc seuls les états déjà atteints sont écrits. */
export const backupRoundCategorySchema = z
  .object({ roundId: id, categoryId: id, status: roundStatusSchema })
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
    roundCategories: z.array(backupRoundCategorySchema),
    roundRoutes: z.array(backupRoundRouteSchema),
    roundQualifiers: z.array(backupRoundQualifierSchema),
    judges: z.array(backupJudgeSchema),
    ascents: z.array(backupAscentSchema),
    ascentEvents: z.array(backupAscentEventSchema),
    activityLog: z.array(backupActivityLogSchema),
  })
  .strict()
export type CompetitionBackup = z.infer<typeof competitionBackupSchema>

/**
 * Format 1 (avant ADR-065) : le statut est sur le tour, et il n'y a pas de
 * `roundCategories`. Gardé uniquement pour relire d'anciennes sauvegardes.
 */
const competitionBackupV1Schema = competitionBackupSchema
  .omit({ schemaVersion: true, rounds: true, roundCategories: true })
  .extend({
    schemaVersion: z.literal(1),
    rounds: z.array(backupRoundSchema.extend({ status: roundStatusSchema })),
  })
  .strict()

/**
 * Remonte une sauvegarde v1 en v2 : l'ancien statut du tour est répliqué sur
 * chaque catégorie liée au tour par `roundRoutes`. Un tour en brouillon
 * n'écrit rien (ligne absente = brouillon). Fonction pure.
 */
function upgradeBackupV1(v1: z.infer<typeof competitionBackupV1Schema>): CompetitionBackup {
  const categoriesByRound = new Map<string, Set<string>>()
  for (const link of v1.roundRoutes) {
    const set = categoriesByRound.get(link.roundId) ?? new Set<string>()
    set.add(link.categoryId)
    categoriesByRound.set(link.roundId, set)
  }
  const roundCategories = v1.rounds
    .filter((r) => r.status !== 'draft')
    .flatMap((r) =>
      [...(categoriesByRound.get(r.id) ?? [])].map((categoryId) => ({
        roundId: r.id,
        categoryId,
        status: r.status,
      })),
    )
  return {
    ...v1,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    rounds: v1.rounds.map((r) => ({
      id: r.id,
      type: r.type,
      style: r.style,
      displayOrder: r.displayOrder,
      qualifyingCount: r.qualifyingCount,
      deletedAt: r.deletedAt,
    })),
    roundCategories,
  }
}

export type ParsedCompetitionBackup =
  { success: true; data: CompetitionBackup } | { success: false; error: z.ZodError }

/**
 * Point d'entrée unique de lecture d'une sauvegarde : aiguille sur la version
 * annoncée par le fichier, sans dégrader les messages d'erreur (un `z.union`
 * les noierait). Toute version lisible ressort au format courant.
 */
export function parseCompetitionBackup(raw: unknown): ParsedCompetitionBackup {
  const declared =
    typeof raw === 'object' && raw !== null && 'schemaVersion' in raw
      ? raw.schemaVersion
      : undefined
  if (declared === 1) {
    const parsed = competitionBackupV1Schema.safeParse(raw)
    return parsed.success
      ? { success: true, data: upgradeBackupV1(parsed.data) }
      : { success: false, error: parsed.error }
  }
  const parsed = competitionBackupSchema.safeParse(raw)
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: parsed.error }
}

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
