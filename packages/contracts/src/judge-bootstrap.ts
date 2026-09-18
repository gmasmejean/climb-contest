import { z } from 'zod'

import { judgeRouteDetailSchema } from './ascent'

/**
 * `GET /judge/bootstrap` (Lot 6, SPEC.md § 6.3) : un appel unique et gros,
 * déclenché une fois au moment où le juge a encore du réseau — persisté
 * intégralement dans IndexedDB, plus jamais requis pour afficher un écran
 * juge. Réutilise `judgeRouteDetailSchema` tel quel (voie + hold_count, tour
 * ouvert, compétiteurs concernés, passages déjà saisis) : aucun nouveau
 * format de donnée.
 */
export const judgeBootstrapResponseSchema = z.object({
  fetchedAt: z.iso.datetime(), // horloge serveur au moment du bootstrap
  judge: z.object({ id: z.uuid(), displayName: z.string() }),
  routes: z.array(judgeRouteDetailSchema),
})
export type JudgeBootstrapResponse = z.infer<typeof judgeBootstrapResponseSchema>
