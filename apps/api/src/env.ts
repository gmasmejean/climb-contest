import 'dotenv/config'

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),
  PUBLIC_APP_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  // Secret distinct du JWT organisateur (Lot 4) : les deux portées ne
  // doivent jamais se mélanger, même en cas de fuite de l'un des deux.
  JWT_JUDGE_SECRET: z.string().min(32),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  MAIL_FROM: z.string().min(1),
  // Réservé aux piles de TEST (e2e) : remplace le plafond des routes
  // d'authentification (10 essais par 15 minutes et par adresse), que la suite
  // e2e dépasse en se connectant une quinzaine de fois. Jamais en production.
  AUTH_RATE_LIMIT_MAX: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined))
    .pipe(z.number().int().positive().optional()),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Configuration invalide (variables d'environnement) : ${details}`)
  }
  return result.data
}
