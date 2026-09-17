import { z } from 'zod'

export const createJudgeInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  routeIds: z.array(z.uuid()).min(1),
  // Optionnel : si renseigné, le lien d'accès est envoyé par e-mail à la
  // création (ADR-027). Jamais le PIN dans cet e-mail — séparation des deux
  // facteurs, décidée avec l'utilisateur.
  email: z.email().optional(),
})
export type CreateJudgeInput = z.infer<typeof createJudgeInputSchema>

/**
 * Réponse à `POST .../judges` — token et PIN en clair. `pin` est absent si la
 * compétition n'exige pas de PIN (`competition.judgePinRequired` au moment de
 * la création — DECISIONS.md ADR-026). Si `competition.judgeCredentialsStored`
 * est vrai (par défaut), ces valeurs sont aussi persistées et redevenues
 * consultables depuis la liste des juges (`accessUrl`/`pin` sur
 * `JudgeSummary` côté web) — sinon, comme au Lot 4, cette réponse est la
 * seule occasion de les voir (ADR-027).
 */
export const judgeCreatedSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  accessToken: z.string(),
  accessUrl: z.string(),
  pin: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  // Présent seulement si un e-mail a été fourni à la création.
  emailSent: z.boolean().optional(),
})
export type JudgeCreated = z.infer<typeof judgeCreatedSchema>

/** Réponse à `POST .../judges/:jid/regenerate-pin` — même logique, un seul juge. */
export const judgePinRegeneratedSchema = z.object({
  id: z.uuid(),
  pin: z.string().regex(/^\d{6}$/),
})
export type JudgePinRegenerated = z.infer<typeof judgePinRegeneratedSchema>

/**
 * `POST .../qrcodes.pdf` — pour un juge dont le jeton n'est pas stocké en
 * clair côté serveur (`judgeCredentialsStored` désactivé au moment de sa
 * création, ADR-026/ADR-027), la planche ne peut inclure son encart que si le
 * client fournit ici le jeton qu'il détient encore lui-même (juste révélé
 * lors de cette session). Les juges dont le jeton EST stocké en clair sont
 * inclus automatiquement, sans figurer dans cette liste. Un juge omis (ni
 * stocké, ni fourni) n'apparaît que sur la page QR publique de la planche.
 */
export const qrSheetInputSchema = z.object({
  judges: z.array(z.object({ judgeId: z.uuid(), accessToken: z.string().min(1) })).default([]),
})
export type QrSheetInput = z.infer<typeof qrSheetInputSchema>

/** `GET /judge/access/:token` — ce que voit l'écran `/j/<token>` avant authentification. */
export const judgeAccessInfoSchema = z.object({
  displayName: z.string(),
  pinRequired: z.boolean(),
})
export type JudgeAccessInfo = z.infer<typeof judgeAccessInfoSchema>

export const judgeAuthInputSchema = z.object({
  token: z.string().trim().min(1),
  pin: z
    .string()
    .regex(/^\d{6}$/, 'Le code doit comporter 6 chiffres.')
    .optional(),
})
export type JudgeAuthInput = z.infer<typeof judgeAuthInputSchema>

const judgeAssignedRouteSchema = z.object({
  id: z.uuid(),
  number: z.number(),
  name: z.string().nullable(),
  holdCount: z.number(),
})

const judgeIdentitySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  routes: z.array(judgeAssignedRouteSchema),
})

/** `GET /judge/me` — identité + voies assignées, sans ré-émettre de jeton. */
export const judgeMeSchema = judgeIdentitySchema
export type JudgeMe = z.infer<typeof judgeMeSchema>

/** `POST /judge/auth` — même identité, accompagnée du JWT nouvellement émis. */
export const judgeSessionSchema = z.object({
  token: z.string(),
  judge: judgeIdentitySchema,
})
export type JudgeSession = z.infer<typeof judgeSessionSchema>
