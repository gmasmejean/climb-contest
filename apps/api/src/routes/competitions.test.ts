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
    sql`truncate table "user", "club", "session", "competition", "round" cascade`,
  )
})

describe('POST /competitions', () => {
  it('crée une compétition contest et son round implicite', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken, { format: 'contest' })

    expect(created.publicSlug).toHaveLength(22)
    expect(created.status).toBe('draft')

    const implicitRound = await handle.db.query.round.findFirst({
      where: (row, { eq }) => eq(row.competitionId, created.id),
    })
    expect(implicitRound?.type).toBe('qualification')
    expect(implicitRound?.displayOrder).toBe(0)
  })

  it('crée une compétition phases sans round implicite, avec une config de cotation par défaut', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken, {
      format: 'phases',
      scoringConfig: undefined,
    })

    const implicitRound = await handle.db.query.round.findFirst({
      where: (row, { eq }) => eq(row.competitionId, created.id),
    })
    expect(implicitRound).toBeUndefined()

    const row = await handle.db.query.competition.findFirst({
      where: (r, { eq }) => eq(r.id, created.id),
    })
    expect(row?.scoringConfig).toEqual({ routesCounted: 1 })
  })

  it('refuse un moteur de cotation inconnu', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const response = await app.request('/api/v1/competitions', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        name: 'Comp',
        venue: 'Salle',
        startsOn: '2026-05-01',
        endsOn: '2026-05-01',
        format: 'contest',
        scoringEngineId: 'moteur-inconnu',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('refuse une scoring_config invalide pour le moteur choisi', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const response = await app.request('/api/v1/competitions', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        name: 'Comp',
        venue: 'Salle',
        startsOn: '2026-05-01',
        endsOn: '2026-05-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        scoringConfig: { routesCounted: 0 },
      }),
    })
    expect(response.status).toBe(400)
  })

  it('refuse une date de fin antérieure à la date de début', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const response = await app.request('/api/v1/competitions', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        name: 'Comp',
        venue: 'Salle',
        startsOn: '2026-05-02',
        endsOn: '2026-05-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        scoringConfig: { routesCounted: 3 },
      }),
    })
    expect(response.status).toBe(400)
  })
})

describe('GET /competitions', () => {
  it("isole les compétitions par club — n'affiche jamais celles d'un autre club", async () => {
    const orgA = await registerLoggedInOrganizer(app, mailer)
    const orgB = await registerLoggedInOrganizer(app, mailer)
    const compA = await createTestCompetition(app, orgA.accessToken, { name: 'Comp A' })
    await createTestCompetition(app, orgB.accessToken, { name: 'Comp B' })

    const listA = await app.request('/api/v1/competitions', {
      headers: authHeaders(orgA.accessToken),
    })
    const bodyA = (await listA.json()) as { id: string; name: string }[]
    expect(bodyA.map((row) => row.id)).toEqual([compA.id])
  })

  it("refuse (404) l'accès à la compétition d'un autre club", async () => {
    const orgA = await registerLoggedInOrganizer(app, mailer)
    const orgB = await registerLoggedInOrganizer(app, mailer)
    const compA = await createTestCompetition(app, orgA.accessToken)

    const response = await app.request(`/api/v1/competitions/${compA.id}`, {
      headers: authHeaders(orgB.accessToken),
    })
    expect(response.status).toBe(404)
  })
})

describe('PATCH /competitions/:id', () => {
  it('met à jour un sous-ensemble de champs', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken)

    const response = await app.request(`/api/v1/competitions/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ venue: 'Nouvelle salle' }),
    })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as { venue: string; name: string }
    expect(updated.venue).toBe('Nouvelle salle')
    expect(updated.name).toBe(created['name'])
  })

  it('refuse de faire passer la date de fin avant la date de début existante', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken, {
      startsOn: '2026-05-10',
      endsOn: '2026-05-12',
    })

    const response = await app.request(`/api/v1/competitions/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ endsOn: '2026-05-09' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('POST /competitions/:id/status', () => {
  it('change le statut', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken)

    const response = await app.request(`/api/v1/competitions/${created.id}/status`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ status: 'open' }),
    })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as { status: string }
    expect(updated.status).toBe('open')
  })
})

describe('GET /competitions/:id/readiness', () => {
  it('est vacuously prêt pour une compétition vide (rien à signaler)', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken, { format: 'contest' })

    const response = await app.request(`/api/v1/competitions/${created.id}/readiness`, {
      headers: authHeaders(accessToken),
    })
    const body = (await response.json()) as { ready: boolean; checks: { id: string }[] }
    expect(body.ready).toBe(true)
    expect(body.checks.map((c) => c.id)).not.toContain('round_without_route')
  })

  it('signale une catégorie sans voie, une voie sans catégorie et un compétiteur sans dossard', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken, { format: 'contest' })

    const categoryResponse = await app.request(`/api/v1/competitions/${created.id}/categories`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ label: 'U16 Femme', sex: 'F' }),
    })
    const category = (await categoryResponse.json()) as { id: string }

    await app.request(`/api/v1/competitions/${created.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40, categoryIds: [] }),
    })

    await app.request(`/api/v1/competitions/${created.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ categoryId: category.id, firstName: 'Léa', lastName: 'Martin' }),
    })

    const response = await app.request(`/api/v1/competitions/${created.id}/readiness`, {
      headers: authHeaders(accessToken),
    })
    const body = (await response.json()) as {
      ready: boolean
      checks: { id: string; ok: boolean; items: unknown[] }[]
    }
    expect(body.ready).toBe(false)
    const byId = Object.fromEntries(body.checks.map((c) => [c.id, c]))
    expect(byId['category_without_route']?.ok).toBe(false)
    expect(byId['route_without_category']?.ok).toBe(false)
    expect(byId['competitor_without_bib']?.ok).toBe(false)
  })

  it('inclut « tour sans voie » seulement en format phases', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken, {
      format: 'phases',
      scoringConfig: undefined,
    })

    await app.request(`/api/v1/competitions/${created.id}/rounds`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ type: 'qualification', style: 'onsight' }),
    })

    const response = await app.request(`/api/v1/competitions/${created.id}/readiness`, {
      headers: authHeaders(accessToken),
    })
    const body = (await response.json()) as { checks: { id: string; ok: boolean }[] }
    const byId = Object.fromEntries(body.checks.map((c) => [c.id, c]))
    expect(byId['round_without_route']?.ok).toBe(false)
  })

  it('signale une voie sans juge assigné, et plus une fois un juge assigné', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const created = await createTestCompetition(app, accessToken, { format: 'contest' })
    const routeResponse = await app.request(`/api/v1/competitions/${created.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40 }),
    })
    const createdRoute = (await routeResponse.json()) as { id: string }

    const before = await app.request(`/api/v1/competitions/${created.id}/readiness`, {
      headers: authHeaders(accessToken),
    })
    const beforeBody = (await before.json()) as { checks: { id: string; ok: boolean }[] }
    expect(
      Object.fromEntries(beforeBody.checks.map((c) => [c.id, c]))['route_without_judge']?.ok,
    ).toBe(false)

    await app.request(`/api/v1/competitions/${created.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge Voie 1', routeIds: [createdRoute.id] }),
    })

    const after = await app.request(`/api/v1/competitions/${created.id}/readiness`, {
      headers: authHeaders(accessToken),
    })
    const afterBody = (await after.json()) as { checks: { id: string; ok: boolean }[] }
    expect(
      Object.fromEntries(afterBody.checks.map((c) => [c.id, c]))['route_without_judge']?.ok,
    ).toBe(true)
  })
})
