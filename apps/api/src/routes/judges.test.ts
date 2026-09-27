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
import {
  authHeaders,
  createTestCompetition,
  registerLoggedInOrganizer,
} from '../test-utils/fixtures'

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
}

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
    sql`truncate table "user", "organization", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "judge", "judge_route" cascade`,
  )
})

async function setupCompetitionWithRoute(
  options: { judgePinRequired?: boolean; judgeCredentialsStored?: boolean } = {},
) {
  const { accessToken } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, accessToken, { format: 'contest' })
  if (options.judgePinRequired !== undefined || options.judgeCredentialsStored !== undefined) {
    await app.request(`/api/v1/competitions/${competition.id}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        ...(options.judgePinRequired !== undefined
          ? { judgePinRequired: options.judgePinRequired }
          : {}),
        ...(options.judgeCredentialsStored !== undefined
          ? { judgeCredentialsStored: options.judgeCredentialsStored }
          : {}),
      }),
    })
  }
  const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ number: 1, holdCount: 40 }),
  })
  const route = (await routeResponse.json()) as { id: string }
  return { accessToken, competition, route }
}

describe('POST /competitions/:id/judges', () => {
  it('crée un juge sans PIN quand la compétition ne l’exige pas (réglage par défaut)', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: false,
    })

    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge A', routeIds: [route.id] }),
    })
    expect(response.status).toBe(201)
    const created = (await response.json()) as {
      accessToken: string
      accessUrl: string
      pin?: string
    }
    expect(created.accessToken).toBeTruthy()
    expect(created.accessUrl).toContain(created.accessToken)
    expect(created.pin).toBeUndefined()
  })

  it('crée un juge avec un PIN à 6 chiffres quand la compétition l’exige', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: true,
    })

    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge B', routeIds: [route.id] }),
    })
    expect(response.status).toBe(201)
    const created = (await response.json()) as { pin?: string }
    expect(created.pin).toMatch(/^\d{6}$/)
  })

  it("refuse une voie qui n'appartient pas à cette compétition", async () => {
    const { accessToken, competition } = await setupCompetitionWithRoute({
      judgePinRequired: false,
    })
    const otherCompetition = await createTestCompetition(app, accessToken, { format: 'contest' })
    const otherRouteResponse = await app.request(
      `/api/v1/competitions/${otherCompetition.id}/routes`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ number: 1, holdCount: 40 }),
      },
    )
    const otherRoute = (await otherRouteResponse.json()) as { id: string }

    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge C', routeIds: [otherRoute.id] }),
    })
    expect(response.status).toBe(400)
  })

  it('refuse un juge sans voie', async () => {
    const { accessToken, competition } = await setupCompetitionWithRoute({
      judgePinRequired: false,
    })
    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge D', routeIds: [] }),
    })
    expect(response.status).toBe(400)
  })
})

describe('GET /competitions/:id/judges', () => {
  it('liste les juges avec leur statut PIN et leurs voies assignées', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: true,
    })
    await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge E', routeIds: [route.id] }),
    })

    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      headers: authHeaders(accessToken),
    })
    expect(response.status).toBe(200)
    const list = (await response.json()) as Array<{
      displayName: string
      hasPin: boolean
      routeIds: string[]
      accessTokenHash?: string
      pinHash?: string
    }>
    expect(list).toHaveLength(1)
    expect(list[0]?.displayName).toBe('Juge E')
    expect(list[0]?.hasPin).toBe(true)
    expect(list[0]?.routeIds).toEqual([route.id])
    expect(list[0]?.accessTokenHash).toBeUndefined()
    expect(list[0]?.pinHash).toBeUndefined()
  })

  it('expose accessUrl/pin en clair par défaut (DECISIONS.md ADR-027)', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: true,
    })
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Clair', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string; accessUrl: string; pin: string }

    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      headers: authHeaders(accessToken),
    })
    const list = (await response.json()) as Array<{
      id: string
      accessUrl?: string
      pin?: string
    }>
    const row = list.find((j) => j.id === created.id)
    expect(row?.accessUrl).toBe(created.accessUrl)
    expect(row?.pin).toBe(created.pin)
  })

  it("n'expose rien en clair quand la compétition désactive la conservation", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: true,
      judgeCredentialsStored: false,
    })
    await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Sans Trace', routeIds: [route.id] }),
    })

    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      headers: authHeaders(accessToken),
    })
    const list = (await response.json()) as Array<{ accessUrl?: string; pin?: string }>
    expect(list[0]?.accessUrl).toBeUndefined()
    expect(list[0]?.pin).toBeUndefined()
  })
})

describe('e-mail à la création', () => {
  it('envoie le lien (sans le PIN) quand un e-mail est fourni', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: true,
    })
    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        displayName: 'Juge Mail',
        routeIds: [route.id],
        email: 'juge-mail@club-demo.test',
      }),
    })
    const created = (await response.json()) as {
      accessUrl: string
      pin: string
      emailSent: boolean
    }
    expect(created.emailSent).toBe(true)

    const sentEmail = mailer.sent.find((email) => email.to === 'juge-mail@club-demo.test')
    expect(sentEmail).toBeDefined()
    expect(sentEmail?.html).toContain(created.accessUrl)
    expect(sentEmail?.html).not.toContain(created.pin)
  })

  it("conserve l'e-mail (ADR-081), consultable ensuite depuis la liste", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        displayName: 'Juge Conservé',
        routeIds: [route.id],
        email: 'juge-conserve@club-demo.test',
      }),
    })
    const created = (await createResponse.json()) as { id: string }

    const listResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      headers: authHeaders(accessToken),
    })
    const list = (await listResponse.json()) as Array<{ id: string; email?: string | null }>
    expect(list.find((j) => j.id === created.id)?.email).toBe('juge-conserve@club-demo.test')
  })

  it("n'envoie rien quand aucun e-mail n'est fourni", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    // `setupCompetitionWithRoute` enregistre l'organisateur, ce qui envoie déjà
    // un e-mail de vérification — on ne compare que ce que la création du
    // juge ajoute par-dessus.
    const sentBefore = mailer.sent.length

    const response = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Sans Mail', routeIds: [route.id] }),
    })
    const created = (await response.json()) as { emailSent?: boolean }
    expect(created.emailSent).toBeUndefined()
    expect(mailer.sent).toHaveLength(sentBefore)
  })
})

describe('PATCH /competitions/:id/judges/:jid', () => {
  it('modifie le nom seul, sans toucher aux voies assignées', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Avant', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ displayName: 'Juge Après' }),
      },
    )
    expect(response.status).toBe(200)
    const updated = (await response.json()) as { displayName: string; routeIds: string[] }
    expect(updated.displayName).toBe('Juge Après')
    expect(updated.routeIds).toEqual([route.id])
  })

  it('change les voies assignées : ajout et retrait', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const otherRouteResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 2, holdCount: 30 }),
    })
    const otherRoute = (await otherRouteResponse.json()) as { id: string }
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Voies', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ routeIds: [otherRoute.id] }),
      },
    )
    expect(response.status).toBe(200)
    const updated = (await response.json()) as { routeIds: string[] }
    expect(updated.routeIds).toEqual([otherRoute.id])
  })

  it('retirer une voie coupe aussitôt l’accès du juge à sa notation (ADR-026)', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Retiré', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string; accessToken: string }
    const judgeAuth = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: created.accessToken }),
    })
    const { token: judgeJwt } = (await judgeAuth.json()) as { token: string }

    await app.request(`/api/v1/competitions/${competition.id}/judges/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ routeIds: [] }),
    })

    const attempt = await app.request(`/api/v1/judge/routes/${route.id}`, {
      headers: { authorization: `Bearer ${judgeJwt}` },
    })
    expect(attempt.status).not.toBe(200)
  })

  it("refuse une voie qui n'appartient pas à cette compétition", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const otherCompetition = await createTestCompetition(app, accessToken, { format: 'contest' })
    const otherRouteResponse = await app.request(
      `/api/v1/competitions/${otherCompetition.id}/routes`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ number: 1, holdCount: 40 }),
      },
    )
    const otherRoute = (await otherRouteResponse.json()) as { id: string }
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Étranger', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ routeIds: [otherRoute.id] }),
      },
    )
    expect(response.status).toBe(400)
  })

  it('modifie et efface l’e-mail', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        displayName: 'Juge Mail Éditable',
        routeIds: [route.id],
        email: 'avant@club-demo.test',
      }),
    })
    const created = (await createResponse.json()) as { id: string }

    const changed = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ email: 'apres@club-demo.test' }),
      },
    )
    expect(((await changed.json()) as { email?: string | null }).email).toBe(
      'apres@club-demo.test',
    )

    const cleared = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ email: null }),
      },
    )
    expect(((await cleared.json()) as { email?: string | null }).email).toBeNull()
  })

  it('404 sur un juge inconnu', async () => {
    const { accessToken, competition } = await setupCompetitionWithRoute()
    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ displayName: 'Fantôme' }),
      },
    )
    expect(response.status).toBe(404)
  })
})

describe('POST /competitions/:id/judges/:jid/resend-access', () => {
  it('réutilise le lien déjà stocké en clair (ADR-027) sans le changer', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        displayName: 'Juge Renvoi',
        routeIds: [route.id],
        email: 'renvoi@club-demo.test',
      }),
    })
    const created = (await createResponse.json()) as { id: string; accessUrl: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/resend-access`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(200)
    const resent = (await response.json()) as {
      accessUrl: string
      regenerated: boolean
      emailSent: boolean
    }
    expect(resent.regenerated).toBe(false)
    expect(resent.accessUrl).toBe(created.accessUrl)
    expect(resent.emailSent).toBe(true)

    const sentEmail = mailer.sent.findLast((email) => email.to === 'renvoi@club-demo.test')
    expect(sentEmail?.html).toContain(resent.accessUrl)
  })

  it("régénère un nouvel accès quand l'ancien n'était pas conservé en clair — l'ancien lien ne fonctionne plus", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgeCredentialsStored: false,
    })
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        displayName: 'Juge Sans Trace',
        routeIds: [route.id],
        email: 'sans-trace@club-demo.test',
      }),
    })
    const created = (await createResponse.json()) as { id: string; accessToken: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/resend-access`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(200)
    const resent = (await response.json()) as { accessUrl: string; regenerated: boolean }
    expect(resent.regenerated).toBe(true)
    expect(resent.accessUrl).not.toContain(created.accessToken)

    const oldTokenAuth = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: created.accessToken }),
    })
    expect(oldTokenAuth.status).toBe(404)

    const newToken = resent.accessUrl.split('/').pop()
    const newTokenAuth = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: newToken }),
    })
    expect(newTokenAuth.status).toBe(200)
  })

  it("refuse quand aucun e-mail n'est renseigné (400)", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Sans Mail', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/resend-access`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(400)
  })

  it('refuse pour un juge révoqué (409)', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute()
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        displayName: 'Juge Révoqué',
        routeIds: [route.id],
        email: 'revoque@club-demo.test',
      }),
    })
    const created = (await createResponse.json()) as { id: string }
    await app.request(`/api/v1/competitions/${competition.id}/judges/${created.id}/revoke`, {
      method: 'POST',
      headers: authHeaders(accessToken),
    })

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/resend-access`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(409)
  })

  it("l'accès reste utilisable même si l'envoi de l'e-mail échoue (emailSent: false)", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgeCredentialsStored: false,
    })
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        displayName: 'Juge SMTP KO',
        routeIds: [route.id],
        email: 'smtp-ko@club-demo.test',
      }),
    })
    const created = (await createResponse.json()) as { id: string }
    mailer.failNext()

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/resend-access`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(200)
    const resent = (await response.json()) as { accessUrl: string; emailSent: boolean }
    expect(resent.emailSent).toBe(false)

    const newToken = resent.accessUrl.split('/').pop()
    const newTokenAuth = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: newToken }),
    })
    expect(newTokenAuth.status).toBe(200)
  })
})

describe('POST /competitions/:id/judges/:jid/revoke', () => {
  it('révoque un juge', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: false,
    })
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge F', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/revoke`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(200)
    const updated = (await response.json()) as { revokedAt: string | null; accessUrl?: string }
    expect(updated.revokedAt).toBeTruthy()
    expect(updated.accessUrl).toBeUndefined()
  })
})

describe('POST /competitions/:id/judges/:jid/regenerate-pin', () => {
  it('régénère le PIN d’un juge qui en a un', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: true,
    })
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge G', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string; pin: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/regenerate-pin`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(200)
    const regenerated = (await response.json()) as { pin: string }
    expect(regenerated.pin).toMatch(/^\d{6}$/)
    expect(regenerated.pin).not.toBe(created.pin)
  })

  it("refuse de régénérer le PIN d'un juge qui n'en a pas (409)", async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: false,
    })
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge H', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/regenerate-pin`,
      { method: 'POST', headers: authHeaders(accessToken) },
    )
    expect(response.status).toBe(409)
  })

  it('suit le réglage ACTUEL de la compétition, pas celui de la création (ADR-027)', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute({
      judgePinRequired: true,
      judgeCredentialsStored: false,
    })
    const createResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge I', routeIds: [route.id] }),
    })
    const created = (await createResponse.json()) as { id: string }

    await app.request(`/api/v1/competitions/${competition.id}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ judgeCredentialsStored: true }),
    })

    await app.request(
      `/api/v1/competitions/${competition.id}/judges/${created.id}/regenerate-pin`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
      },
    )

    const listResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      headers: authHeaders(accessToken),
    })
    const list = (await listResponse.json()) as Array<{ id: string; pin?: string }>
    expect(list.find((j) => j.id === created.id)?.pin).toMatch(/^\d{6}$/)
  })
})
