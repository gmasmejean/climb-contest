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
import { authenticateJudge, createJudgeFixture, judgeAuthHeaders } from '../test-utils/fixtures'

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
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "judge", "judge_route" cascade`,
  )
})

interface BootstrapBody {
  fetchedAt: string
  judge: { id: string; displayName: string }
  routes: Array<{
    route: { id: string; number: number; holdCount: number }
    round: { id: string; type: string } | null
    competitors: Array<{
      id: string
      bib: number | null
      ascent: { holdNumber: number | null } | null
    }>
  }>
}

describe('GET /judge/bootstrap', () => {
  it('renvoie en un seul appel tout ce dont le juge a besoin pour la journée', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)

    const response = await app.request('/api/v1/judge/bootstrap', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as BootstrapBody

    expect(body.judge.id).toBe(fixture.judge.id)
    expect(body.routes).toHaveLength(1)
    expect(body.routes[0]?.route.id).toBe(fixture.route.id)
    expect(body.routes[0]?.round?.id).toBeTruthy()
    expect(body.routes[0]?.competitors.map((comp) => comp.id)).toContain(fixture.competitor.id)
    expect(new Date(body.fetchedAt).getTime()).not.toBeNaN()
  })

  it('reflète le même contenu que GET /routes/:routeId pour la même voie', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)

    const bootstrapResponse = await app.request('/api/v1/judge/bootstrap', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    const bootstrapBody = (await bootstrapResponse.json()) as BootstrapBody

    const routeDetailResponse = await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
      headers: judgeAuthHeaders(judgeJwt),
    })
    const routeDetail = await routeDetailResponse.json()

    expect(bootstrapBody.routes[0]).toEqual(routeDetail)
  })

  it("ne renvoie que les voies assignées à CE juge, jamais celles d'un autre", async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const other = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)

    const response = await app.request('/api/v1/judge/bootstrap', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    const body = (await response.json()) as BootstrapBody

    expect(body.routes.map((r) => r.route.id)).not.toContain(other.route.id)
  })

  it('un juge révoqué est bloqué avant même d’atteindre le bootstrap (SPEC.md § 3.2)', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    await app.request(
      `/api/v1/competitions/${fixture.competition.id}/judges/${fixture.judge.id}/revoke`,
      { method: 'POST', headers: { authorization: `Bearer ${fixture.organizerToken}` } },
    )

    const response = await app.request('/api/v1/judge/bootstrap', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(401)
  })

  it('inclut les passages déjà saisis sur les voies assignées', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    const routeDetailResponse = await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
      headers: judgeAuthHeaders(judgeJwt),
    })
    const { round } = (await routeDetailResponse.json()) as { round: { id: string } }

    await app.request('/api/v1/judge/ascents', {
      method: 'POST',
      headers: judgeAuthHeaders(judgeJwt),
      body: JSON.stringify({
        id: crypto.randomUUID(),
        roundId: round.id,
        routeId: fixture.route.id,
        competitorId: fixture.competitor.id,
        holdNumber: 18,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        climbTimeMs: null,
        recordedAt: new Date().toISOString(),
        deviceId: 'device-test-1',
      }),
    })

    const response = await app.request('/api/v1/judge/bootstrap', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    const body = (await response.json()) as BootstrapBody
    const competitorEntry = body.routes[0]?.competitors.find(
      (comp) => comp.id === fixture.competitor.id,
    )
    expect(competitorEntry?.ascent?.holdNumber).toBe(18)
  })
})
