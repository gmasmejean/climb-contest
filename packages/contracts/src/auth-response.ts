/**
 * Isolé de `auth.ts` volontairement : ce schéma dépend de `organizerSchema`
 * (dérivé de la table Drizzle complète via `entities.ts`), pendant que
 * `auth.ts` ne contient que des schémas de saisie purs, sans dépendance à la
 * couche base — c'est ce que `Register.vue` importe côté web, et il ne doit
 * jamais entraîner tout le graphe `drizzle-zod` dans son bundle. Le web
 * n'importe `AuthResponse` que comme *type* (effacé à la compilation) ;
 * seul `apps/api` a besoin de la valeur `authResponseSchema`.
 */
import { z } from 'zod'

import { organizerSchema } from './entities'

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: organizerSchema,
})
export type AuthResponse = z.infer<typeof authResponseSchema>
