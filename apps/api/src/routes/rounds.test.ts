import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner } from '../lib/jwt'
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
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "route", "route_category", "round_route" cascade`,
  )
})

async function setupPhasesCompetition() {
  const { accessToken } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, accessToken, {
    format: 'phases',
    scoringConfig: undefined,
  })
  return { accessToken, competition }
}

describe('tours — format contest', () => {
  it('refuse tout accès aux tours pour une compétition contest (400)', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const competition = await createTestCompetition(app, accessToken, { format: 'contest' })

    const response = await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
      headers: authHeaders(accessToken),
    })
    expect(response.status).toBe(400)
  })
})

describe('POST /competitions/:id/rounds', () => {
  it('crée un tour avec un display_order auto-incrémenté', async () => {
    const { accessToken, competition } = await setupPhasesCompetition()
    const first = await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ type: 'qualification', style: 'flash' }),
    })
    const second = await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ type: 'final', style: 'onsight' }),
    })
    expect(((await first.json()) as { displayOrder: number }).displayOrder).toBe(0)
    expect(((await second.json()) as { displayOrder: number }).displayOrder).toBe(1)
  })
})

describe('POST /competitions/:id/rounds/reorder', () => {
  it('applique le nouvel ordre demandé', async () => {
    const { accessToken, competition } = await setupPhasesCompetition()
    const a = (await (
      await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ type: 'qualification', style: 'flash' }),
      })
    ).json()) as { id: string }
    const b = (await (
      await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ type: 'final', style: 'onsight' }),
      })
    ).json()) as { id: string }

    const response = await app.request(`/api/v1/competitions/${competition.id}/rounds/reorder`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ orderedIds: [b.id, a.id] }),
    })
    const reordered = (await response.json()) as { id: string; displayOrder: number }[]
    expect(reordered.map((row) => row.id)).toEqual([b.id, a.id])
    expect(reordered.map((row) => row.displayOrder)).toEqual([0, 1])
  })
})

describe('PUT /competitions/:id/rounds/:roundId/routes', () => {
  it("refuse une affectation dont la voie n'est pas liée à la catégorie (400)", async () => {
    const { accessToken, competition } = await setupPhasesCompetition()
    const round = (await (
      await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ type: 'qualification', style: 'flash' }),
      })
    ).json()) as { id: string }
    const category = (await (
      await app.request(`/api/v1/competitions/${competition.id}/categories`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
      })
    ).json()) as { id: string }
    const route = (await (
      await app.request(`/api/v1/competitions/${competition.id}/routes`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ number: 1, holdCount: 40 }), // pas affectée à la catégorie
      })
    ).json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/rounds/${round.id}/routes`,
      {
        method: 'PUT',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ assignments: [{ routeId: route.id, categoryId: category.id }] }),
      },
    )
    expect(response.status).toBe(400)
  })

  it('accepte une affectation voie × catégorie déjà liée par route_category', async () => {
    const { accessToken, competition } = await setupPhasesCompetition()
    const round = (await (
      await app.request(`/api/v1/competitions/${competition.id}/rounds`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ type: 'qualification', style: 'flash' }),
      })
    ).json()) as { id: string }
    const category = (await (
      await app.request(`/api/v1/competitions/${competition.id}/categories`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
      })
    ).json()) as { id: string }
    const route = (await (
      await app.request(`/api/v1/competitions/${competition.id}/routes`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ number: 1, holdCount: 40, categoryIds: [category.id] }),
      })
    ).json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/rounds/${round.id}/routes`,
      {
        method: 'PUT',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ assignments: [{ routeId: route.id, categoryId: category.id }] }),
      },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { routeId: string; categoryId: string }[]
    expect(body).toEqual([{ routeId: route.id, categoryId: category.id }])

    const getResponse = await app.request(
      `/api/v1/competitions/${competition.id}/rounds/${round.id}/routes`,
      { headers: authHeaders(accessToken) },
    )
    expect((await getResponse.json()) as unknown[]).toEqual([
      { routeId: route.id, categoryId: category.id },
    ])
  })
})
