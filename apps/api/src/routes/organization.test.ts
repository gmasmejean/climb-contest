import type { Member } from '@climbcontest/contracts'
import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { FakeMailer } from '../test-utils/fake-mailer'
import { authHeaders, registerLoggedInOrganizer } from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: '',
  CORS_ORIGIN: 'http://localhost:5173',
  PUBLIC_APP_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-32',
  JWT_JUDGE_SECRET: 'test-judge-secret-test-judge-secret-32',
  SMTP_HOST: 'localhost',
  SMTP_PORT: 1025,
  SMTP_SECURE: false,
  MAIL_FROM: 'no-reply@climbcontest.test',
  AUTH_RATE_LIMIT_MAX: 10_000,
}

const PASSWORD = 'un-mot-de-passe-solide'

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16.15-alpine').start()
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  await applyPendingMigrations(client)
  await client.end()
  handle = createDatabase(container.getConnectionUri())
}, 180_000)

afterAll(async () => {
  await handle.close()
  await container.stop()
})

beforeEach(() => {
  mailer = new FakeMailer()
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "organization", "session", "organization_member_log" cascade`,
  )
})

function cookieHeaderFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

const post = (path: string, token: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: authHeaders(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function login(email: string, password = PASSWORD) {
  return app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

async function invite(
  ownerToken: string,
  email: string,
  role: 'owner' | 'organizer' = 'organizer',
) {
  const response = await post('/api/v1/auth/invitations', ownerToken, {
    email,
    displayName: email.split('@')[0] ?? email,
    role,
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Member
}

/** Invite, accepte l'invitation et renvoie le membre connecté. */
async function addMember(
  ownerToken: string,
  email: string,
  role: 'owner' | 'organizer' = 'organizer',
) {
  const member = await invite(ownerToken, email, role)
  const accepted = await app.request('/api/v1/auth/invitations/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: mailer.lastTokenFor(email), password: PASSWORD }),
  })
  expect(accepted.status).toBe(201)
  const { accessToken } = (await accepted.json()) as { accessToken: string }
  return { member, accessToken }
}

async function members(token: string): Promise<Member[]> {
  const response = await app.request('/api/v1/organization/members', {
    headers: authHeaders(token),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as Member[]
}

/** Actions du journal des membres, triées par nom (l'ordre d'écriture n'est pas l'objet). */
async function logActions(): Promise<string[]> {
  const result = await handle.db.execute(sql`select action from organization_member_log`)
  return result.rows.map((row) => (row as { action: string }).action).sort()
}

async function ownerWorld() {
  const owner = await registerLoggedInOrganizer(app, mailer)
  const [self] = await members(owner.accessToken)
  if (!self) throw new Error('owner introuvable')
  return { ...owner, id: self.id }
}

describe('GET /organization/members', () => {
  it('liste les membres de SA organisation, avec leur statut', async () => {
    const owner = await ownerWorld()
    await addMember(owner.accessToken, 'active@club-demo.test')
    await invite(owner.accessToken, 'pending@club-demo.test')
    const other = await registerLoggedInOrganizer(app, mailer)

    const list = await members(owner.accessToken)
    expect(list.map((m) => [m.email, m.role, m.status])).toEqual(
      expect.arrayContaining([
        [owner.email, 'owner', 'active'],
        ['active@club-demo.test', 'organizer', 'active'],
        ['pending@club-demo.test', 'organizer', 'invited'],
      ]),
    )
    expect(list).toHaveLength(3)
    expect(list.find((m) => m.status === 'invited')?.invitationExpiresAt).not.toBeNull()
    expect((await members(other.accessToken)).map((m) => m.email)).toEqual([other.email])
  })

  it('est lisible par un organizer, et ne montre ni mot de passe ni jeton', async () => {
    const owner = await ownerWorld()
    const { accessToken } = await addMember(owner.accessToken, 'lecteur@club-demo.test')
    const response = await app.request('/api/v1/organization/members', {
      headers: authHeaders(accessToken),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).not.toMatch(/passwordHash|pendingToken|argon2/)
  })
})

describe('réservé aux owners', () => {
  it('un organizer reçoit 403 sur chaque action', async () => {
    const owner = await ownerWorld()
    const { accessToken } = await addMember(owner.accessToken, 'orga@club-demo.test')
    const pending = await invite(owner.accessToken, 'pending@club-demo.test')
    const base = `/api/v1/organization/members`
    const attempts = [
      post(`${base}/${pending.id}/invitation`, accessToken),
      app.request(`${base}/${pending.id}/invitation`, {
        method: 'DELETE',
        headers: authHeaders(accessToken),
      }),
      app.request(`${base}/${owner.id}`, {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ role: 'organizer' }),
      }),
      post(`${base}/${owner.id}/deactivate`, accessToken),
      post(`${base}/${owner.id}/reactivate`, accessToken),
    ]
    const responses = await Promise.all(attempts.map((attempt) => Promise.resolve(attempt)))
    for (const response of responses) expect(response.status).toBe(403)
  })

  it('un owner d’une autre organisation reçoit 404 sur un membre qui n’est pas le sien', async () => {
    const owner = await ownerWorld()
    const { member } = await addMember(owner.accessToken, 'cible@club-demo.test')
    const intruder = await registerLoggedInOrganizer(app, mailer)
    const response = await post(
      `/api/v1/organization/members/${member.id}/deactivate`,
      intruder.accessToken,
    )
    expect(response.status).toBe(404)
    expect((await members(owner.accessToken)).find((m) => m.id === member.id)?.status).toBe(
      'active',
    )
  })

  it('le rôle est relu en base : un owner rétrogradé perd ses droits sans attendre son jeton', async () => {
    const owner = await ownerWorld()
    const second = await addMember(owner.accessToken, 'second@club-demo.test', 'owner')
    const demoted = await app.request(`/api/v1/organization/members/${owner.id}`, {
      method: 'PATCH',
      headers: authHeaders(second.accessToken),
      body: JSON.stringify({ role: 'organizer' }),
    })
    expect(demoted.status).toBe(200)

    // Le jeton de `owner` dit encore `role: owner`.
    const response = await post('/api/v1/auth/invitations', owner.accessToken, {
      email: 'x@club-demo.test',
      displayName: 'X',
      role: 'organizer',
    })
    expect(response.status).toBe(403)
  })
})

describe('invitations', () => {
  it('refuse une adresse déjà membre, et dit quoi faire si le compte est désactivé', async () => {
    const owner = await ownerWorld()
    const { member } = await addMember(owner.accessToken, 'deja@club-demo.test')
    const again = await post('/api/v1/auth/invitations', owner.accessToken, {
      email: 'deja@club-demo.test',
      displayName: 'Déjà',
      role: 'organizer',
    })
    expect(again.status).toBe(409)
    expect(((await again.json()) as { detail: string }).detail).toContain(
      'fait déjà partie de votre organisation',
    )

    await post(`/api/v1/organization/members/${member.id}/deactivate`, owner.accessToken)
    const afterDeactivation = await post('/api/v1/auth/invitations', owner.accessToken, {
      email: 'deja@club-demo.test',
      displayName: 'Déjà',
      role: 'organizer',
    })
    expect(((await afterDeactivation.json()) as { detail: string }).detail).toContain(
      'réactivez-le',
    )
  })

  it('refuse une adresse qui appartient à une autre organisation (une personne, une organisation)', async () => {
    const owner = await ownerWorld()
    const other = await registerLoggedInOrganizer(app, mailer)
    const response = await post('/api/v1/auth/invitations', owner.accessToken, {
      email: other.email,
      displayName: 'Ailleurs',
      role: 'organizer',
    })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { detail: string }).detail).toContain(
      'une seule organisation',
    )
  })

  it('relancer émet un nouveau lien : l’ancien ne vaut plus, le nouveau active le compte', async () => {
    const owner = await ownerWorld()
    const pending = await invite(owner.accessToken, 'relance@club-demo.test')
    const firstToken = mailer.lastTokenFor('relance@club-demo.test')

    const resent = await post(
      `/api/v1/organization/members/${pending.id}/invitation`,
      owner.accessToken,
    )
    expect(resent.status).toBe(200)
    const secondToken = mailer.lastTokenFor('relance@club-demo.test')
    expect(secondToken).not.toBe(firstToken)

    const accept = (token: string) =>
      app.request('/api/v1/auth/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: PASSWORD }),
      })
    expect((await accept(firstToken)).status).toBe(400)
    expect((await accept(secondToken)).status).toBe(201)
    expect(await logActions()).toEqual(['invitation_resent', 'invited'].sort())

    // Une fois activé, il n'y a plus d'invitation à relancer.
    const late = await post(
      `/api/v1/organization/members/${pending.id}/invitation`,
      owner.accessToken,
    )
    expect(late.status).toBe(409)
  })

  it('annuler supprime l’invitation : le lien ne vaut plus, l’adresse peut être réinvitée', async () => {
    const owner = await ownerWorld()
    const pending = await invite(owner.accessToken, 'annule@club-demo.test')
    const token = mailer.lastTokenFor('annule@club-demo.test')

    const cancelled = await app.request(`/api/v1/organization/members/${pending.id}/invitation`, {
      method: 'DELETE',
      headers: authHeaders(owner.accessToken),
    })
    expect(cancelled.status).toBe(204)
    expect((await members(owner.accessToken)).map((m) => m.email)).not.toContain(
      'annule@club-demo.test',
    )
    const accept = await app.request('/api/v1/auth/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: PASSWORD }),
    })
    expect(accept.status).toBe(400)

    const log = await handle.db.execute(
      sql`select target_email from organization_member_log where action = 'invitation_cancelled'`,
    )
    expect(log.rows).toEqual([{ target_email: 'annule@club-demo.test' }])

    await invite(owner.accessToken, 'annule@club-demo.test')
  })

  it('refuse d’annuler l’invitation d’un compte déjà activé', async () => {
    const owner = await ownerWorld()
    const { member } = await addMember(owner.accessToken, 'actif@club-demo.test')
    const response = await app.request(`/api/v1/organization/members/${member.id}/invitation`, {
      method: 'DELETE',
      headers: authHeaders(owner.accessToken),
    })
    expect(response.status).toBe(409)
  })
})

describe('changement de rôle', () => {
  const patchRole = (token: string, memberId: string, role: string) =>
    app.request(`/api/v1/organization/members/${memberId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ role }),
    })

  it('promeut un organizer, trace l’ancien et le nouveau rôle', async () => {
    const owner = await ownerWorld()
    const { member } = await addMember(owner.accessToken, 'promu@club-demo.test')
    const response = await patchRole(owner.accessToken, member.id, 'owner')
    expect(response.status).toBe(200)
    expect(((await response.json()) as Member).role).toBe('owner')

    const log = await handle.db.execute(
      sql`select details from organization_member_log where action = 'role_changed'`,
    )
    expect(log.rows).toEqual([{ details: { from: 'organizer', to: 'owner' } }])
  })

  it('refuse de rétrograder le dernier owner actif, avec un message qui dit quoi faire', async () => {
    const owner = await ownerWorld()
    const response = await patchRole(owner.accessToken, owner.id, 'organizer')
    expect(response.status).toBe(409)
    expect(((await response.json()) as { detail: string }).detail).toContain(
      'au moins un propriétaire actif',
    )
    expect((await members(owner.accessToken))[0]?.role).toBe('owner')
  })

  it('un owner peut se rétrograder s’il en reste un autre', async () => {
    const owner = await ownerWorld()
    await addMember(owner.accessToken, 'relais@club-demo.test', 'owner')
    expect((await patchRole(owner.accessToken, owner.id, 'organizer')).status).toBe(200)
  })

  it('un owner seulement invité ne compte pas comme owner actif', async () => {
    const owner = await ownerWorld()
    await invite(owner.accessToken, 'pas-encore@club-demo.test', 'owner')
    expect((await patchRole(owner.accessToken, owner.id, 'organizer')).status).toBe(409)
  })

  it('refuse un rôle inconnu', async () => {
    const owner = await ownerWorld()
    expect((await patchRole(owner.accessToken, owner.id, 'admin')).status).toBe(400)
  })
})

describe('désactivation', () => {
  it('coupe les sessions, refuse la connexion, et se défait par la réactivation', async () => {
    const owner = await ownerWorld()
    const { member } = await addMember(owner.accessToken, 'part@club-demo.test')
    const sessionLogin = await login('part@club-demo.test')
    const cookie = cookieHeaderFrom(sessionLogin)

    const deactivated = await post(
      `/api/v1/organization/members/${member.id}/deactivate`,
      owner.accessToken,
    )
    expect(deactivated.status).toBe(200)
    expect(((await deactivated.json()) as Member).status).toBe('deactivated')

    const refresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { cookie },
    })
    expect(refresh.status).toBe(401)

    const refused = await login('part@club-demo.test')
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { detail: string }).detail).toContain(
      'désactivé par un responsable de votre organisation',
    )
    // Sans le bon mot de passe, rien ne dit que le compte est désactivé.
    expect((await login('part@club-demo.test', 'pas-le-bon-mot-de-passe')).status).toBe(401)

    const reactivated = await post(
      `/api/v1/organization/members/${member.id}/reactivate`,
      owner.accessToken,
    )
    expect(((await reactivated.json()) as Member).status).toBe('active')
    expect((await login('part@club-demo.test')).status).toBe(200)
    expect(await logActions()).toEqual(['deactivated', 'invited', 'reactivated'].sort())
  })

  it('refuse de se désactiver soi-même', async () => {
    const owner = await ownerWorld()
    const response = await post(
      `/api/v1/organization/members/${owner.id}/deactivate`,
      owner.accessToken,
    )
    expect(response.status).toBe(409)
    expect(((await response.json()) as { detail: string }).detail).toContain('votre propre compte')
  })

  it('renvoie vers « annuler » pour une invitation pas encore acceptée', async () => {
    const owner = await ownerWorld()
    const pending = await invite(owner.accessToken, 'attente@club-demo.test')
    const response = await post(
      `/api/v1/organization/members/${pending.id}/deactivate`,
      owner.accessToken,
    )
    expect(response.status).toBe(409)
    expect(((await response.json()) as { detail: string }).detail).toContain(
      'annulez plutôt l’invitation',
    )
  })

  it('un owner désactivé perd ses droits d’owner tout de suite', async () => {
    const owner = await ownerWorld()
    const second = await addMember(owner.accessToken, 'ex-owner@club-demo.test', 'owner')
    await post(`/api/v1/organization/members/${second.member.id}/deactivate`, owner.accessToken)
    const response = await post('/api/v1/auth/invitations', second.accessToken, {
      email: 'y@club-demo.test',
      displayName: 'Y',
      role: 'organizer',
    })
    expect(response.status).toBe(403)
  })
})
