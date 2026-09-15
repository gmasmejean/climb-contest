import {
  acceptInviteInputSchema,
  inviteInputSchema,
  loginInputSchema,
  organizerSchema,
  registerInputSchema,
  resendVerificationInputSchema,
  verifyEmailInputSchema,
  type AuthResponse,
} from '@climbcontest/contracts'
import {
  club,
  hashPassword,
  hashToken,
  randomToken,
  session,
  user,
  verifyPassword,
  type Database,
} from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { Env } from '../env'
import { invitationEmail, verificationEmail } from '../lib/email-templates'
import { clientIp } from '../lib/http'
import type { AccessTokenSigner } from '../lib/jwt'
import type { Mailer } from '../lib/mailer'
import { slugify } from '../lib/slug'
import { requireOrganizer, requireOwner } from '../middleware/auth'
import { ApiError, problem } from '../middleware/problem'
import { authRateLimiter } from '../middleware/rate-limit'

const REFRESH_COOKIE_NAME = 'refresh_token'
const REFRESH_COOKIE_PATH = '/api/v1/auth'
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface AuthRouteDeps {
  db: Database
  mailer: Mailer
  env: Env
  accessTokenSigner: AccessTokenSigner
}

type UserRow = typeof user.$inferSelect

export function createAuthRoutes(deps: AuthRouteDeps): Hono {
  const app = new Hono()
  const { db, mailer, env, accessTokenSigner } = deps

  async function issueSession(c: Context, row: UserRow): Promise<AuthResponse> {
    const refreshToken = randomToken(32)
    await db.insert(session).values({
      userId: row.id,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: c.req.header('user-agent') ?? null,
      ip: clientIp(c),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    })
    setCookie(c, REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_MS / 1000,
    })
    const accessToken = await accessTokenSigner.sign({
      sub: row.id,
      clubId: row.clubId,
      role: row.role === 'owner' ? 'owner' : 'organizer',
    })
    const response: AuthResponse = { accessToken, user: organizerSchema.parse(row) }
    return response
  }

  app.post(
    '/register',
    authRateLimiter(10, 15 * 60 * 1000),
    zValidator('json', registerInputSchema, (result, c) => {
      if (!result.success) {
        return problem(c, 400, 'Inscription invalide', result.error.issues[0]?.message)
      }
    }),
    async (c) => {
      const input = c.req.valid('json')

      const existing = await db.query.user.findFirst({ where: eq(user.email, input.email) })
      if (existing) {
        throw new ApiError(409, 'Compte existant', 'Un compte existe déjà avec cet e-mail.')
      }

      const baseSlug = slugify(input.clubName) || 'club'
      let slug = baseSlug
      let createdClub: typeof club.$inferSelect | undefined
      for (let attempt = 0; attempt < 5 && !createdClub; attempt += 1) {
        try {
          const [row] = await db.insert(club).values({ name: input.clubName, slug }).returning()
          createdClub = row
        } catch {
          slug = `${baseSlug}-${randomToken(4).toLowerCase()}`
        }
      }
      if (!createdClub) {
        throw new ApiError(500, 'Erreur interne', 'Impossible de créer le club.')
      }

      const verificationToken = randomToken(32)
      const [createdUser] = await db
        .insert(user)
        .values({
          clubId: createdClub.id,
          email: input.email,
          passwordHash: await hashPassword(input.password),
          displayName: input.displayName,
          role: 'owner',
          pendingTokenHash: hashToken(verificationToken),
          pendingTokenPurpose: 'email_verification',
          pendingTokenExpiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
        })
        .returning()
      if (!createdUser) {
        throw new ApiError(500, 'Erreur interne', "Impossible de créer le compte.")
      }

      const verifyUrl = `${env.PUBLIC_APP_URL}/login?token=${verificationToken}`
      const { subject, html } = verificationEmail(input.displayName, verifyUrl)
      await mailer.send(input.email, subject, html)

      return c.json(
        { message: 'Compte créé — vérifiez votre boîte mail pour l’activer.' },
        201,
      )
    },
  )

  // POST, jamais GET : un GET ne doit jamais avoir d'effet de bord — de
  // nombreuses passerelles anti-hameçonnage pré-visitent automatiquement les
  // liens reçus par e-mail pour les scanner, ce qui consommerait le jeton à
  // la place de l'utilisateur si ce GET modifiait la base. Le lien de
  // l'e-mail pointe vers /login?token=…, une page du front sans effet de
  // bord ; c'est le JavaScript de cette page, dans un vrai navigateur, qui
  // déclenche ce POST.
  app.post(
    '/verify-email',
    zValidator('json', verifyEmailInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Requête invalide')
    }),
    async (c) => {
      const { token } = c.req.valid('json')
      const tokenHash = hashToken(token)
      const row = await db.query.user.findFirst({
        where: and(eq(user.pendingTokenHash, tokenHash), eq(user.pendingTokenPurpose, 'email_verification')),
      })
      if (!row) {
        throw new ApiError(400, 'Jeton invalide', 'Ce lien de vérification est invalide ou a déjà été utilisé.')
      }
      if (!row.pendingTokenExpiresAt || row.pendingTokenExpiresAt.getTime() < Date.now()) {
        throw new ApiError(400, 'Jeton expiré', 'Ce lien a expiré — demandez un nouvel e-mail.')
      }
      await db
        .update(user)
        .set({
          emailVerifiedAt: new Date(),
          pendingTokenHash: null,
          pendingTokenPurpose: null,
          pendingTokenExpiresAt: null,
        })
        .where(eq(user.id, row.id))
      return c.json({ message: 'E-mail vérifié — vous pouvez vous connecter.' })
    },
  )

  app.post(
    '/resend-verification',
    authRateLimiter(5, 15 * 60 * 1000),
    zValidator('json', resendVerificationInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Requête invalide')
    }),
    async (c) => {
      const { email } = c.req.valid('json')
      const row = await db.query.user.findFirst({
        where: and(eq(user.email, email), isNull(user.emailVerifiedAt), isNull(user.invitedByUserId)),
      })
      if (row) {
        const verificationToken = randomToken(32)
        await db
          .update(user)
          .set({
            pendingTokenHash: hashToken(verificationToken),
            pendingTokenPurpose: 'email_verification',
            pendingTokenExpiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
          })
          .where(eq(user.id, row.id))
        const verifyUrl = `${env.PUBLIC_APP_URL}/login?token=${verificationToken}`
        const { subject, html } = verificationEmail(row.displayName, verifyUrl)
        await mailer.send(email, subject, html)
      }
      return c.json({
        message: "Si un compte existe et n'est pas encore vérifié, un e-mail a été envoyé.",
      })
    },
  )

  app.post(
    '/login',
    authRateLimiter(10, 15 * 60 * 1000),
    zValidator('json', loginInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Requête invalide')
    }),
    async (c) => {
      const { email, password } = c.req.valid('json')
      const row = await db.query.user.findFirst({ where: eq(user.email, email) })
      if (!row) {
        throw new ApiError(401, 'Identifiants invalides', 'E-mail ou mot de passe incorrect.')
      }
      if (!row.passwordHash) {
        throw new ApiError(
          403,
          'Compte non activé',
          "Ce compte n'a pas encore été activé — vérifiez votre invitation.",
        )
      }
      const validPassword = await verifyPassword(row.passwordHash, password)
      if (!validPassword) {
        throw new ApiError(401, 'Identifiants invalides', 'E-mail ou mot de passe incorrect.')
      }
      if (!row.emailVerifiedAt) {
        throw new ApiError(
          403,
          'E-mail non vérifié',
          'Vérifiez votre e-mail avant de vous connecter.',
        )
      }

      await db.update(user).set({ lastLoginAt: new Date() }).where(eq(user.id, row.id))
      const result = await issueSession(c, row)
      return c.json(result)
    },
  )

  app.post('/refresh', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE_NAME)
    if (!refreshToken) {
      throw new ApiError(401, 'Session invalide', 'Aucune session active.')
    }
    const tokenHash = hashToken(refreshToken)
    const row = await db.query.session.findFirst({ where: eq(session.refreshTokenHash, tokenHash) })

    if (!row) {
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
      throw new ApiError(401, 'Session invalide', 'Cette session est inconnue — reconnectez-vous.')
    }

    if (row.revokedAt) {
      // Réutilisation d'un refresh token déjà consommé : session compromise,
      // on révoque tout l'historique de l'utilisateur par précaution.
      await db
        .update(session)
        .set({ revokedAt: new Date() })
        .where(and(eq(session.userId, row.userId), isNull(session.revokedAt)))
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
      throw new ApiError(
        401,
        'Session compromise',
        'Ce jeton a déjà été utilisé — toutes vos sessions ont été révoquées, reconnectez-vous.',
      )
    }

    if (row.expiresAt.getTime() < Date.now()) {
      await db.update(session).set({ revokedAt: new Date() }).where(eq(session.id, row.id))
      deleteCookie(c, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
      throw new ApiError(401, 'Session expirée', 'Reconnectez-vous.')
    }

    const userRow = await db.query.user.findFirst({ where: eq(user.id, row.userId) })
    if (!userRow) {
      throw new ApiError(401, 'Session invalide', 'Compte introuvable.')
    }

    await db.update(session).set({ revokedAt: new Date() }).where(eq(session.id, row.id))
    const result = await issueSession(c, userRow)
    return c.json(result)
  })

  app.post('/logout', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE_NAME)
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken)
      await db
        .update(session)
        .set({ revokedAt: new Date() })
        .where(and(eq(session.refreshTokenHash, tokenHash), isNull(session.revokedAt)))
    }
    deleteCookie(c, REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH })
    return c.body(null, 204)
  })

  app.post(
    '/invitations',
    requireOrganizer(accessTokenSigner),
    requireOwner(),
    zValidator('json', inviteInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Requête invalide')
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const input = c.req.valid('json')

      const existing = await db.query.user.findFirst({ where: eq(user.email, input.email) })
      if (existing) {
        throw new ApiError(409, 'Compte existant', 'Un compte existe déjà avec cet e-mail.')
      }

      const [inviter, currentClub] = await Promise.all([
        db.query.user.findFirst({ where: eq(user.id, organizer.sub) }),
        db.query.club.findFirst({ where: eq(club.id, organizer.clubId) }),
      ])
      if (!inviter || !currentClub) {
        throw new ApiError(401, 'Session invalide', 'Compte introuvable.')
      }

      const invitationToken = randomToken(32)
      await db.insert(user).values({
        clubId: organizer.clubId,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        invitedByUserId: organizer.sub,
        pendingTokenHash: hashToken(invitationToken),
        pendingTokenPurpose: 'invitation',
        pendingTokenExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      })

      const acceptUrl = `${env.PUBLIC_APP_URL}/accept-invite?token=${invitationToken}`
      const { subject, html } = invitationEmail(
        input.displayName,
        currentClub.name,
        inviter.displayName,
        acceptUrl,
      )
      await mailer.send(input.email, subject, html)

      return c.json({ message: 'Invitation envoyée.' }, 201)
    },
  )

  app.post(
    '/invitations/accept',
    zValidator('json', acceptInviteInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const { token, password } = c.req.valid('json')
      const tokenHash = hashToken(token)
      const row = await db.query.user.findFirst({
        where: and(eq(user.pendingTokenHash, tokenHash), eq(user.pendingTokenPurpose, 'invitation')),
      })
      if (!row) {
        throw new ApiError(400, 'Invitation invalide', 'Cette invitation est invalide ou a déjà été utilisée.')
      }
      if (!row.pendingTokenExpiresAt || row.pendingTokenExpiresAt.getTime() < Date.now()) {
        throw new ApiError(400, 'Invitation expirée', "Cette invitation a expiré — demandez-en une nouvelle.")
      }

      const [updated] = await db
        .update(user)
        .set({
          passwordHash: await hashPassword(password),
          emailVerifiedAt: new Date(),
          pendingTokenHash: null,
          pendingTokenPurpose: null,
          pendingTokenExpiresAt: null,
        })
        .where(eq(user.id, row.id))
        .returning()
      if (!updated) {
        throw new ApiError(500, 'Erreur interne', "Impossible d'activer le compte.")
      }

      const result = await issueSession(c, updated)
      return c.json(result, 201)
    },
  )

  return app
}
