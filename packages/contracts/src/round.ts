import { z } from 'zod'

export const roundTypeSchema = z.enum(['qualification', 'semifinal', 'final'])
export const roundStyleSchema = z.enum(['flash', 'onsight'])
export const roundStatusSchema = z.enum(['draft', 'open', 'closed', 'published'])
export type RoundStatus = z.infer<typeof roundStatusSchema>

export const createRoundInputSchema = z.object({
  type: roundTypeSchema,
  style: roundStyleSchema,
  qualifyingCount: z.number().int().positive().nullable().optional(),
})
export type CreateRoundInput = z.infer<typeof createRoundInputSchema>

/**
 * `status` n'est plus accepté ici depuis le Lot 8 : le garde-fou de
 * transition (graphe autorisé, blocage si conflit non résolu — DECISIONS.md)
 * vit uniquement dans `POST .../rounds/:roundId/status`
 * (`changeRoundStatusInputSchema` ci-dessous). Un seul chemin d'écriture pour
 * le statut, jamais deux — sinon ce PATCH générique contournerait le
 * garde-fou.
 */
export const updateRoundInputSchema = createRoundInputSchema.partial()
export type UpdateRoundInput = z.infer<typeof updateRoundInputSchema>

/**
 * Lot 8 (DECISIONS.md) — transition de statut d'un tour, format-agnostique :
 * fonctionne aussi pour le tour implicite du format contest (ADR-040), donc
 * volontairement en dehors du routeur `rounds.ts` qui reste réservé au format
 * phases (`requirePhasesFormat`).
 */
export const changeRoundStatusInputSchema = z.object({ status: roundStatusSchema })
export type ChangeRoundStatusInput = z.infer<typeof changeRoundStatusInputSchema>

/**
 * Graphe de transition (Lot 8, décidé avec l'utilisateur — DECISIONS.md) :
 * séquentiel, avec possibilité de rouvrir un tour clos ou de dépublier.
 * Exporté ici (plutôt que dupliqué côté `apps/api` et `apps/web`) pour que
 * le bouton désactivé côté client et le refus serveur reflètent exactement
 * la même règle.
 */
export const ROUND_STATUS_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: ['open', 'published'],
  published: ['closed'],
}

export const reorderRoundsInputSchema = z.object({
  orderedIds: z.array(z.uuid()).min(1),
})
export type ReorderRoundsInput = z.infer<typeof reorderRoundsInputSchema>

export const setRoundRoutesInputSchema = z.object({
  assignments: z.array(
    z.object({
      routeId: z.uuid(),
      categoryId: z.uuid(),
    }),
  ),
})
export type SetRoundRoutesInput = z.infer<typeof setRoundRoutesInputSchema>
