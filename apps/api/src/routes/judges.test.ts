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
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "judge", "judge_route" cascade`,
  )
})

async function setupCompetitionWithRoute(judgePinRequired = false) {
  const { accessToken } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, accessToken, { format: 'contest' })
  if (judgePinRequired) {
    await app.request(`/api/v1/competitions/${competition.id}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ judgePinRequired: true }),
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
    const { accessToken, competition, route } = await setupCompetitionWithRoute(false)

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
    const { accessToken, competition, route } = await setupCompetitionWithRoute(true)

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
    const { accessToken, competition } = await setupCompetitionWithRoute(false)
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
    const { accessToken, competition } = await setupCompetitionWithRoute(false)
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
    const { accessToken, competition, route } = await setupCompetitionWithRoute(true)
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
})

describe('POST /competitions/:id/judges/:jid/revoke', () => {
  it('révoque un juge', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute(false)
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
    const updated = (await response.json()) as { revokedAt: string | null }
    expect(updated.revokedAt).toBeTruthy()
  })
})

describe('POST /competitions/:id/judges/:jid/regenerate-pin', () => {
  it('régénère le PIN d’un juge qui en a un', async () => {
    const { accessToken, competition, route } = await setupCompetitionWithRoute(true)
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
    const { accessToken, competition, route } = await setupCompetitionWithRoute(false)
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
})
