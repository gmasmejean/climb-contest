import { z } from 'zod'

import { competitionFormatSchema, competitionStatusSchema } from './competition'
import { roundStatusSchema, roundTypeSchema } from './round'

/**
 * Contrats de la page publique `/c/<slug>` (ROADMAP.md Lot 7). Écrits à la
 * main, PAS dérivés de `createSelectSchema` (contrairement à
 * `entities.ts`) : le public ne voit que nom, prénom, club, dossard
 * (SPEC.md §6.4) — jamais `birthYear`/`licenseNumber`. Un schéma écrit à la
 * main garantit cette absence par construction ; un `.omit()` après-coup sur
 * l'entité complète ne le garantirait que jusqu'à la prochaine colonne
 * ajoutée à `competitor` qu'on oublierait d'omettre. `.strict()` sur chaque
 * schéma : Zod ne rejette pas les champs inconnus par défaut (il les
 * retire silencieusement), ce qui masquerait une fuite de champ au lieu de
 * la faire échouer bruyamment.
 */

export const publicCategoryQuerySchema = z.object({ category: z.uuid() }).strict()
export type PublicCategoryQuery = z.infer<typeof publicCategoryQuerySchema>

export const publicCategorySchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    displayOrder: z.number(),
  })
  .strict()
export type PublicCategory = z.infer<typeof publicCategorySchema>

/**
 * Vide en format contest : le round implicite (ADR-023) n'est jamais exposé
 * à l'organisateur, et n'a pas d'état à montrer au public non plus — voir
 * ROADMAP.md Lot 7, point 1 (« pour le format phases : l'état de chaque
 * tour »), qui ne le demande qu'en phases.
 */
export const publicRoundSchema = z
  .object({
    id: z.uuid(),
    type: roundTypeSchema,
    displayOrder: z.number(),
    status: roundStatusSchema,
  })
  .strict()
export type PublicRound = z.infer<typeof publicRoundSchema>

export const publicCompetitionSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    venue: z.string(),
    startsOn: z.string(),
    endsOn: z.string(),
    format: competitionFormatSchema,
    status: competitionStatusSchema,
  })
  .strict()
export type PublicCompetition = z.infer<typeof publicCompetitionSchema>

export const publicCompetitionMetaSchema = z
  .object({
    competition: publicCompetitionSchema,
    categories: z.array(publicCategorySchema),
    rounds: z.array(publicRoundSchema),
  })
  .strict()
export type PublicCompetitionMeta = z.infer<typeof publicCompetitionMetaSchema>

export const publicRouteSchema = z
  .object({
    id: z.uuid(),
    number: z.number(),
    name: z.string().nullable(),
    holdCount: z.number(),
    sector: z.string().nullable(),
    color: z.string().nullable(),
    videoUrl: z.url().nullable(),
    // Lot 9 : une vidéo téléversée, lue depuis l'API (`.../routes/:id/video`).
    hasUploadedVideo: z.boolean(),
  })
  .strict()
export type PublicRoute = z.infer<typeof publicRouteSchema>

/**
 * Champs bruts, pas de texte français précalculé côté API — c'est
 * `apps/web` qui les traduit en « prise 25+ » / « TOP » / « chute », au même
 * titre que l'écran juge (cohérence d'un seul endroit de formatage côté
 * client plutôt que deux, un serveur et un client).
 */
export const publicRankingRouteDetailSchema = z
  .object({
    routeId: z.uuid(),
    routeNumber: z.number(),
    routeName: z.string().nullable(),
    holdNumber: z.number().nullable(),
    modifier: z.enum(['none', 'plus']),
    isTop: z.boolean(),
    status: z.enum(['valid', 'dns', 'dnf', 'dsq']),
    routeRank: z.number(),
  })
  .strict()
export type PublicRankingRouteDetail = z.infer<typeof publicRankingRouteDetailSchema>

/**
 * Un tour auquel le compétiteur a participé, avec le détail de chacune de
 * ses voies — décision utilisateur (2026-09-18) : le dépliant montre TOUS
 * les tours participés (qualif + demi + finale), pas seulement le dernier
 * atteint, pour que le spectateur voie le parcours complet.
 */
export const publicRankingRoundDetailSchema = z
  .object({
    roundId: z.uuid(),
    roundType: roundTypeSchema,
    combinedRank: z.number(),
    routes: z.array(publicRankingRouteDetailSchema),
  })
  .strict()
export type PublicRankingRoundDetail = z.infer<typeof publicRankingRoundDetailSchema>

export const publicRankingEntrySchema = z
  .object({
    rank: z.number(),
    bib: z.number().nullable(),
    firstName: z.string(),
    lastName: z.string(),
    club: z.string().nullable(),
    reachedRoundId: z.uuid(),
    rounds: z.array(publicRankingRoundDetailSchema),
  })
  .strict()
export type PublicRankingEntry = z.infer<typeof publicRankingEntrySchema>

export const publicRankingResponseSchema = z
  .object({
    categoryId: z.uuid(),
    /** Faux si aucun tour concernant cette catégorie n'a encore été ouvert. */
    started: z.boolean(),
    /** Vrai si au moins un tour contribuant à ce classement n'est pas publié. */
    provisional: z.boolean(),
    generatedAt: z.iso.datetime(),
    entries: z.array(publicRankingEntrySchema),
  })
  .strict()
export type PublicRankingResponse = z.infer<typeof publicRankingResponseSchema>

/**
 * SPEC.md §7 n'en documentait que 2 sur 3 — omission corrigée avec ce lot :
 * `route_updated` est explicitement demandé par ROADMAP.md Lot 7, point 2.
 * Payload volontairement un pointeur léger (jamais un dump de données) : le
 * client réagit en invalidant/reinterrogeant la requête concernée, le même
 * chemin que le chargement initial et le repli en sondage.
 */
export const publicStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ranking_updated'), competitionId: z.uuid(), categoryId: z.uuid() }).strict(),
  z
    .object({ type: z.literal('round_status_changed'), competitionId: z.uuid(), roundId: z.uuid() })
    .strict(),
  z.object({ type: z.literal('route_updated'), competitionId: z.uuid(), routeId: z.uuid() }).strict(),
])
export type PublicStreamEvent = z.infer<typeof publicStreamEventSchema>
