import {
  applyPendingMigrations,
  ascent,
  createDatabase,
  roundRoute,
  user,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq, sql } from 'drizzle-orm'
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
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent" cascade`,
  )
})

async function setupContestCompetitionWithCategory() {
  const { accessToken, email } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, accessToken, { format: 'contest' })
  const categoryResponse = await app.request(`/api/v1/competitions/${competition.id}/categories`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
  })
  const category = (await categoryResponse.json()) as { id: string }
  return { accessToken, email, competition, category }
}

describe('POST /competitions/:id/routes', () => {
  it('crée une voie affectée à une catégorie et synchronise le round implicite (mode contest)', async () => {
    const { accessToken, competition, category } = await setupContestCompetitionWithCategory()

    const response = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40, categoryIds: [category.id] }),
    })
    expect(response.status).toBe(201)
    const created = (await response.json()) as { id: string; categoryIds: string[] }
    expect(created.categoryIds).toEqual([category.id])

    const implicitRound = await handle.db.query.round.findFirst({
      where: (row, { eq: whereEq }) => whereEq(row.competitionId, competition.id),
    })
    const link = await handle.db.query.roundRoute.findFirst({
      where: and(
        eq(roundRoute.roundId, implicitRound?.id ?? ''),
        eq(roundRoute.routeId, created.id),
        eq(roundRoute.categoryId, category.id),
      ),
    })
    expect(link).toBeDefined()
  })

  it('refuse un numéro de voie déjà utilisé', async () => {
    const { accessToken, competition } = await setupContestCompetitionWithCategory()
    await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40 }),
    })
    const response = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 35 }),
    })
    expect(response.status).toBe(409)
  })

  it("refuse une catégorie qui n'appartient pas à la compétition", async () => {
    const { accessToken, competition } = await setupContestCompetitionWithCategory()
    const response = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        number: 1,
        holdCount: 40,
        categoryIds: ['0189dcd5-5311-7d40-8db0-9496a2eef37b'],
      }),
    })
    expect(response.status).toBe(400)
  })
})

describe('PATCH /competitions/:id/routes/:routeId', () => {
  it('met à jour les catégories affectées et synchronise round_route', async () => {
    const { accessToken, competition, category } = await setupContestCompetitionWithCategory()
    const secondCategoryResponse = await app.request(
      `/api/v1/competitions/${competition.id}/categories`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ label: 'U18 Femme', sex: 'F' }),
      },
    )
    const secondCategory = (await secondCategoryResponse.json()) as { id: string }

    const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40, categoryIds: [category.id] }),
    })
    const route = (await routeResponse.json()) as { id: string }

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/routes/${route.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ categoryIds: [secondCategory.id] }),
      },
    )
    const updated = (await response.json()) as { categoryIds: string[] }
    expect(updated.categoryIds).toEqual([secondCategory.id])

    const implicitRound = await handle.db.query.round.findFirst({
      where: (row, { eq: whereEq }) => whereEq(row.competitionId, competition.id),
    })
    const oldLink = await handle.db.query.roundRoute.findFirst({
      where: and(
        eq(roundRoute.roundId, implicitRound?.id ?? ''),
        eq(roundRoute.routeId, route.id),
        eq(roundRoute.categoryId, category.id),
      ),
    })
    const newLink = await handle.db.query.roundRoute.findFirst({
      where: and(
        eq(roundRoute.roundId, implicitRound?.id ?? ''),
        eq(roundRoute.routeId, route.id),
        eq(roundRoute.categoryId, secondCategory.id),
      ),
    })
    expect(oldLink).toBeUndefined()
    expect(newLink).toBeDefined()
  })

  it('bloque la modification du nombre de prises si un passage existe (ADR-004)', async () => {
    const { accessToken, email, competition, category } =
      await setupContestCompetitionWithCategory()
    const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40, categoryIds: [category.id] }),
    })
    const route = (await routeResponse.json()) as { id: string }

    const competitorResponse = await app.request(
      `/api/v1/competitions/${competition.id}/competitors`,
      {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ categoryId: category.id, firstName: 'Léa', lastName: 'Martin' }),
      },
    )
    const competitor = (await competitorResponse.json()) as { id: string }

    const implicitRound = await handle.db.query.round.findFirst({
      where: (row, { eq: whereEq }) => whereEq(row.competitionId, competition.id),
    })
    const organizerUser = await handle.db.query.user.findFirst({ where: eq(user.email, email) })
    if (!implicitRound || !organizerUser) throw new Error('fixture incomplète')

    await handle.db.insert(ascent).values({
      id: crypto.randomUUID(),
      competitionId: competition.id,
      roundId: implicitRound.id,
      routeId: route.id,
      competitorId: competitor.id,
      holdCount: 40,
      status: 'valid',
      isTop: true,
      recordedByUserId: organizerUser.id,
      deviceId: 'test',
      recordedAt: new Date(),
    })

    const response = await app.request(
      `/api/v1/competitions/${competition.id}/routes/${route.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ holdCount: 45 }),
      },
    )
    expect(response.status).toBe(409)
  })
})

describe('POST /competitions/:id/routes/reorder', () => {
  it('renumérote les voies dans le nouvel ordre demandé', async () => {
    const { accessToken, competition } = await setupContestCompetitionWithCategory()
    const routeAResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40 }),
    })
    const routeA = (await routeAResponse.json()) as { id: string }
    const routeBResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 2, holdCount: 35 }),
    })
    const routeB = (await routeBResponse.json()) as { id: string }

    const response = await app.request(`/api/v1/competitions/${competition.id}/routes/reorder`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ orderedIds: [routeB.id, routeA.id] }),
    })
    const reordered = (await response.json()) as { id: string; number: number }[]
    expect(reordered.map((row) => row.id)).toEqual([routeB.id, routeA.id])
    expect(reordered.map((row) => row.number)).toEqual([1, 2])
  })
})
