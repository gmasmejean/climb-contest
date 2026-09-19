import { z } from 'zod'

/**
 * Un lien de vidéo n'est JAMAIS autre chose que http(s). `z.url()` accepte
 * n'importe quel protocole, dont `javascript:` : posé en `href` sur la page
 * publique, un clic exécuterait du script dans l'origine de l'application
 * (XSS stockée, exploitable pour voler la session d'un organisateur connecté
 * qui visite le lien — l'inscription étant ouverte, n'importe qui peut poser
 * ce lien). Revue de sécurité, Lot 9.
 */
export const httpUrlSchema = z.url({ protocol: /^https?$/ })

/** Vrai pour une URL http(s) — pour assainir ce qui a pu être stocké avant cette règle. */
export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export const createRouteInputSchema = z.object({
  number: z.number().int().positive(),
  name: z.string().trim().max(120).nullable().optional(),
  holdCount: z.number().int().positive(),
  sector: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(50).nullable().optional(),
  videoUrl: httpUrlSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  categoryIds: z.array(z.uuid()).default([]),
})
export type CreateRouteInput = z.infer<typeof createRouteInputSchema>

/**
 * `holdCount` reste dans le schéma de saisie mais son édition est bloquée
 * côté API dès qu'un passage existe sur la voie (ADR-004) — pas un souci de
 * validation de forme, donc pas modélisé ici.
 */
export const updateRouteInputSchema = createRouteInputSchema.partial()
export type UpdateRouteInput = z.infer<typeof updateRouteInputSchema>

export const reorderRoutesInputSchema = z.object({
  orderedIds: z.array(z.uuid()).min(1),
})
export type ReorderRoutesInput = z.infer<typeof reorderRoutesInputSchema>
