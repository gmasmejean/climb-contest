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

describe('GET /judge/routes', () => {
  it('renvoie la voie assignée avec une progression 0/1 quand le tour est ouvert', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)

    const response = await app.request('/api/v1/judge/routes', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{
      id: string
      number: number
      categories: Array<{ id: string; label: string }>
      progress: { done: number; expected: number } | null
    }>
    expect(body).toHaveLength(1)
    expect(body[0]?.number).toBe(1)
    expect(body[0]?.categories).toEqual([
      { id: fixture.category.id, label: fixture.category.label },
    ])
    expect(body[0]?.progress).toEqual({ done: 0, expected: 1 })
  })

  it("renvoie une progression `null` quand aucun tour n'est ouvert", async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: false })
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)

    const response = await app.request('/api/v1/judge/routes', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ progress: unknown }>
    expect(body[0]?.progress).toBeNull()
  })
})

describe('GET /judge/routes/:routeId', () => {
  it('renvoie le tour ouvert et le compétiteur en « à faire »', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)

    const response = await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      round: { id: string } | null
      timingEnabled: boolean
      competitors: Array<{ id: string; bib: number | null; ascent: unknown }>
    }
    expect(body.round).not.toBeNull()
    expect(body.timingEnabled).toBe(false)
    expect(body.competitors).toEqual([
      {
        id: fixture.competitor.id,
        bib: fixture.competitor.bib,
        firstName: fixture.competitor.firstName,
        lastName: fixture.competitor.lastName,
        categoryLabel: fixture.category.label,
        ascent: null,
      },
    ])
  })

  it('refuse une voie non assignée (404 générique)', async () => {
    const fixtureA = await createJudgeFixture(app, mailer)
    const fixtureB = await createJudgeFixture(app, mailer)
    const judgeAJwt = await authenticateJudge(app, fixtureA.judge.accessToken, fixtureA.judge.pin)

    const response = await app.request(`/api/v1/judge/routes/${fixtureB.route.id}`, {
      headers: judgeAuthHeaders(judgeAJwt),
    })
    expect(response.status).toBe(404)
  })
})
