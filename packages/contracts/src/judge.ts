import { z } from 'zod'

export const createJudgeInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  routeIds: z.array(z.uuid()).min(1),
})
export type CreateJudgeInput = z.infer<typeof createJudgeInputSchema>

/**
 * Réponse à `POST .../judges` — token et PIN en clair, affichés une seule
 * fois par l'écran organisateur (SPEC.md § 5, jamais journalisés, jamais
 * relisibles ensuite). `pin` est absent si la compétition n'exige pas de PIN
 * (`competition.judgePinRequired` au moment de la création — DECISIONS.md
 * ADR-026).
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
})
export type JudgeCreated = z.infer<typeof judgeCreatedSchema>

/** Réponse à `POST .../judges/:jid/regenerate-pin` — même logique, un seul juge. */
export const judgePinRegeneratedSchema = z.object({
  id: z.uuid(),
  pin: z.string().regex(/^\d{6}$/),
})
export type JudgePinRegenerated = z.infer<typeof judgePinRegeneratedSchema>

/**
 * `POST .../qrcodes.pdf` — le serveur ne connaît jamais un jeton d'accès en
 * clair après sa création (seul le hash est stocké, SPEC.md § 5), donc la
 * planche ne peut être composée qu'à partir des jetons que le client détient
 * encore lui-même (juste révélés lors de cette session — DECISIONS.md
 * ADR-026). Un juge omis ici n'apparaît que sur la page QR publique de la
 * planche, pas dans les encarts individuels.
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
