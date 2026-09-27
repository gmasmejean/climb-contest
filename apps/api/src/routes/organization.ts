import { changeMemberRoleInputSchema } from '@climbcontest/contracts'
import {
  hashToken,
  organization,
  organizationMemberLog,
  randomToken,
  session,
  user,
  type Database,
} from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import type { Env } from '../env'
import { invitationEmail } from '../lib/email-templates'
import type { AccessTokenSigner } from '../lib/jwt'
import type { Mailer } from '../lib/mailer'
import {
  compareMembers,
  isPendingInvitation,
  removesLastActiveOwner,
  toMember,
} from '../lib/members'
import { requireOrganizer, requireOwner } from '../middleware/auth'
import { ApiError, problem } from '../middleware/problem'
import { INVITATION_TTL_MS } from './auth'

export interface OrganizationRouteDeps {
  db: Database
  mailer: Mailer
  env: Env
  accessTokenSigner: AccessTokenSigner
  now?: (() => Date) | undefined
}

type UserRow = typeof user.$inferSelect
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type MemberAction = typeof organizationMemberLog.$inferInsert.action

const LAST_OWNER_DETAIL =
  'Votre organisation doit garder au moins un propriétaire actif. Donnez d’abord ce rôle à un autre membre.'

/**
 * Membres de l'organisation (Lot 24, DECISIONS.md ADR-087). Lecture pour tout
 * membre ; tout le reste est réservé aux owners, dont le rôle est relu en base.
 * Un membre d'une autre organisation répond 404, jamais 403, comme pour les
 * compétitions.
 */
export function createOrganizationRoutes(deps: OrganizationRouteDeps): Hono {
  const app = new Hono()
  const { db, mailer, env, accessTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireOrganizer(accessTokenSigner))

  async function findMember(executor: Database | Tx, organizationId: string, memberId: string) {
    const row = await executor.query.user.findFirst({
      where: and(eq(user.id, memberId), eq(user.organizationId, organizationId)),
    })
    if (!row) {
      throw new ApiError(
        404,
        'Membre introuvable',
        'Ce membre ne fait pas partie de votre organisation.',
      )
    }
    return row
  }

  async function log(
    executor: Database | Tx,
    actorUserId: string,
    target: UserRow,
    action: MemberAction,
    details: Record<string, string> = {},
  ): Promise<void> {
    await executor.insert(organizationMemberLog).values({
      organizationId: target.organizationId,
      actorUserId,
      targetUserId: target.id,
      targetEmail: target.email,
      targetDisplayName: target.displayName,
      action,
      details,
    })
  }

  /**
   * Verrouille les membres de l'organisation le temps de la transaction
   * (ADR-087 point 6) : deux owners qui se retirent mutuellement leur rôle au
   * même instant ne laissent pas l'organisation sans owner.
   */
  async function lockMembers(tx: Tx, organizationId: string): Promise<UserRow[]> {
    return tx.select().from(user).where(eq(user.organizationId, organizationId)).for('update')
  }

  app.get('/members', async (c) => {
    const organizer = c.get('organizer')
    const rows = await db.query.user.findMany({
      where: eq(user.organizationId, organizer.organizationId),
    })
    const at = now()
    return c.json(rows.map((row) => toMember(row, at)).sort(compareMembers))
  })

  app.post('/members/:memberId/invitation', requireOwner(db), async (c) => {
    const organizer = c.get('organizer')
    const target = await findMember(db, organizer.organizationId, c.req.param('memberId'))
    if (!isPendingInvitation(target)) {
      throw new ApiError(409, 'Déjà activé', `${target.displayName} a déjà activé son compte.`)
    }
    const [inviter, currentOrganization] = await Promise.all([
      db.query.user.findFirst({ where: eq(user.id, organizer.sub) }),
      db.query.organization.findFirst({ where: eq(organization.id, organizer.organizationId) }),
    ])
    if (!inviter || !currentOrganization) {
      throw new ApiError(401, 'Session invalide', 'Compte introuvable.')
    }

    // ADR-087 point 3 : un nouveau jeton, l'ancien lien ne vaut plus.
    const invitationToken = randomToken(32)
    const [updated] = await db
      .update(user)
      .set({
        pendingTokenHash: hashToken(invitationToken),
        pendingTokenExpiresAt: new Date(now().getTime() + INVITATION_TTL_MS),
        updatedAt: now(),
      })
      .where(eq(user.id, target.id))
      .returning()
    if (!updated) throw new ApiError(500, 'Erreur interne', "Impossible de relancer l'invitation.")
    await log(db, organizer.sub, updated, 'invitation_resent')

    const acceptUrl = `${env.PUBLIC_APP_URL}/accept-invite?token=${invitationToken}`
    const { subject, html } = invitationEmail(
      updated.displayName,
      currentOrganization.name,
      inviter.displayName,
      acceptUrl,
    )
    await mailer.send(updated.email, subject, html)
    return c.json(toMember(updated, now()))
  })

  app.delete('/members/:memberId/invitation', requireOwner(db), async (c) => {
    const organizer = c.get('organizer')
    const target = await findMember(db, organizer.organizationId, c.req.param('memberId'))
    if (!isPendingInvitation(target)) {
      throw new ApiError(
        409,
        'Déjà activé',
        `${target.displayName} a déjà activé son compte : désactivez-le plutôt.`,
      )
    }
    // ADR-087 point 4 : le compte n'a jamais servi, rien ne le référence. La
    // trace survit dans le journal ; la même adresse pourra être réinvitée.
    await db.transaction(async (tx) => {
      await log(tx, organizer.sub, target, 'invitation_cancelled')
      await tx.delete(user).where(eq(user.id, target.id))
    })
    return c.body(null, 204)
  })

  app.patch(
    '/members/:memberId',
    requireOwner(db),
    zValidator('json', changeMemberRoleInputSchema, (result, c) => {
      if (!result.success) return problem(c, 400, 'Requête invalide')
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const memberId = c.req.param('memberId')
      const { role } = c.req.valid('json')
      const updated = await db.transaction(async (tx) => {
        const members = await lockMembers(tx, organizer.organizationId)
        const target = members.find((member) => member.id === memberId)
        if (!target) {
          throw new ApiError(
            404,
            'Membre introuvable',
            'Ce membre ne fait pas partie de votre organisation.',
          )
        }
        if (target.role === role) return target
        if (target.deactivatedAt) {
          throw new ApiError(
            409,
            'Compte désactivé',
            `Réactivez d’abord le compte de ${target.displayName} pour changer son rôle.`,
          )
        }
        if (role === 'organizer' && removesLastActiveOwner(members, target.id)) {
          throw new ApiError(409, 'Dernier propriétaire', LAST_OWNER_DETAIL)
        }
        const [row] = await tx
          .update(user)
          .set({ role, updatedAt: now() })
          .where(eq(user.id, target.id))
          .returning()
        if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible de changer le rôle.')
        await log(tx, organizer.sub, row, 'role_changed', { from: target.role, to: role })
        return row
      })
      return c.json(toMember(updated, now()))
    },
  )

  app.post('/members/:memberId/deactivate', requireOwner(db), async (c) => {
    const organizer = c.get('organizer')
    const memberId = c.req.param('memberId')
    if (memberId === organizer.sub) {
      throw new ApiError(
        409,
        'Action impossible',
        'Vous ne pouvez pas désactiver votre propre compte. Demandez-le à un autre propriétaire.',
      )
    }
    const updated = await db.transaction(async (tx) => {
      const members = await lockMembers(tx, organizer.organizationId)
      const target = members.find((member) => member.id === memberId)
      if (!target) {
        throw new ApiError(
          404,
          'Membre introuvable',
          'Ce membre ne fait pas partie de votre organisation.',
        )
      }
      if (target.deactivatedAt) return target
      if (isPendingInvitation(target)) {
        throw new ApiError(
          409,
          'Invitation en attente',
          `${target.displayName} n’a pas encore activé son compte : annulez plutôt l’invitation.`,
        )
      }
      if (removesLastActiveOwner(members, target.id)) {
        throw new ApiError(409, 'Dernier propriétaire', LAST_OWNER_DETAIL)
      }
      const at = now()
      const [row] = await tx
        .update(user)
        .set({ deactivatedAt: at, updatedAt: at })
        .where(eq(user.id, target.id))
        .returning()
      if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible de désactiver le compte.')
      await tx
        .update(session)
        .set({ revokedAt: at })
        .where(and(eq(session.userId, target.id), isNull(session.revokedAt)))
      await log(tx, organizer.sub, row, 'deactivated')
      return row
    })
    return c.json(toMember(updated, now()))
  })

  app.post('/members/:memberId/reactivate', requireOwner(db), async (c) => {
    const organizer = c.get('organizer')
    const target = await findMember(db, organizer.organizationId, c.req.param('memberId'))
    if (!target.deactivatedAt) return c.json(toMember(target, now()))
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(user)
        .set({ deactivatedAt: null, updatedAt: now() })
        .where(eq(user.id, target.id))
        .returning()
      if (!row) throw new ApiError(500, 'Erreur interne', 'Impossible de réactiver le compte.')
      await log(tx, organizer.sub, row, 'reactivated')
      return row
    })
    return c.json(toMember(updated, now()))
  })

  return app
}
