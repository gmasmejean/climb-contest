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

describe('POST /competitions/:id/qrcodes.pdf', () => {
  it("génère un PDF avec seulement la page publique quand aucun juge n'est fourni", async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const competition = await createTestCompetition(app, accessToken, { format: 'contest' })

    const response = await app.request(`/api/v1/competitions/${competition.id}/qrcodes.pdf`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ judges: [] }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46])) // %PDF
  })

  it('inclut un encart par juge quand le jeton fourni correspond', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const competition = await createTestCompetition(app, accessToken, { format: 'contest' })
    const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40 }),
    })
    const route = (await routeResponse.json()) as { id: string }
    const judgeResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge PDF', routeIds: [route.id] }),
    })
    const createdJudge = (await judgeResponse.json()) as { id: string; accessToken: string }

    const response = await app.request(`/api/v1/competitions/${competition.id}/qrcodes.pdf`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        judges: [{ judgeId: createdJudge.id, accessToken: createdJudge.accessToken }],
      }),
    })
    expect(response.status).toBe(200)
  })

  it('refuse un jeton fourni qui ne correspond plus au juge (400)', async () => {
    const { accessToken } = await registerLoggedInOrganizer(app, mailer)
    const competition = await createTestCompetition(app, accessToken, { format: 'contest' })
    const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ number: 1, holdCount: 40 }),
    })
    const route = (await routeResponse.json()) as { id: string }
    const judgeResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ displayName: 'Juge PDF 2', routeIds: [route.id] }),
    })
    const createdJudge = (await judgeResponse.json()) as { id: string }

    const response = await app.request(`/api/v1/competitions/${competition.id}/qrcodes.pdf`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        judges: [{ judgeId: createdJudge.id, accessToken: 'un-jeton-invente' }],
      }),
    })
    expect(response.status).toBe(400)
  })
})
