import { z } from 'zod'

const passwordSchema = z
  .string()
  .min(12, 'Le mot de passe doit contenir au moins 12 caractères.')
  .max(200)

export const registerInputSchema = z.object({
  email: z.email(),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120),
  clubName: z.string().trim().min(1).max(120),
})
export type RegisterInput = z.infer<typeof registerInputSchema>

export const verifyEmailInputSchema = z.object({
  token: z.string().min(1),
})
export type VerifyEmailInput = z.infer<typeof verifyEmailInputSchema>

export const resendVerificationInputSchema = z.object({
  email: z.email(),
})
export type ResendVerificationInput = z.infer<typeof resendVerificationInputSchema>

export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginInputSchema>

export const inviteInputSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(['owner', 'organizer']),
})
export type InviteInput = z.infer<typeof inviteInputSchema>

export const acceptInviteInputSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
})
export type AcceptInviteInput = z.infer<typeof acceptInviteInputSchema>
