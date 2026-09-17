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

async function createJudge(judgePinRequired: boolean) {
  const { accessToken: organizerToken } = await registerLoggedInOrganizer(app, mailer)
  // `endsOn` dans le futur : le JWT juge expire à fin de compétition + 12h
  // (SPEC.md § 3.2) — la date par défaut de createTestCompetition (2026-05-01)
  // est déjà passée par rapport à « aujourd'hui », ce qui invaliderait
  // immédiatement le jeton émis dans les tests ci-dessous.
  const competition = await createTestCompetition(app, organizerToken, {
    format: 'contest',
    startsOn: '2099-01-01',
    endsOn: '2099-01-01',
  })
  if (judgePinRequired) {
    await app.request(`/api/v1/competitions/${competition.id}`, {
      method: 'PATCH',
      headers: authHeaders(organizerToken),
      body: JSON.stringify({ judgePinRequired: true }),
    })
  }
  const routeResponse = await app.request(`/api/v1/competitions/${competition.id}/routes`, {
    method: 'POST',
    headers: authHeaders(organizerToken),
    body: JSON.stringify({ number: 1, holdCount: 40 }),
  })
  const route = (await routeResponse.json()) as { id: string }
  const judgeResponse = await app.request(`/api/v1/competitions/${competition.id}/judges`, {
    method: 'POST',
    headers: authHeaders(organizerToken),
    body: JSON.stringify({ displayName: 'Juge Test', routeIds: [route.id] }),
  })
  const created = (await judgeResponse.json()) as {
    id: string
    accessToken: string
    pin?: string
  }
  return { organizerToken, competition, route, judge: created }
}

describe('GET /judge/access/:token', () => {
  it('refuse un jeton inconnu', async () => {
    const response = await app.request('/api/v1/judge/access/un-jeton-inconnu')
    expect(response.status).toBe(404)
  })

  it('indique si un PIN est requis pour un jeton valide', async () => {
    const { judge } = await createJudge(true)
    const response = await app.request(`/api/v1/judge/access/${judge.accessToken}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { displayName: string; pinRequired: boolean }
    expect(body.pinRequired).toBe(true)
    expect(body.displayName).toBe('Juge Test')
  })

  it('refuse un jeton révoqué', async () => {
    const { organizerToken, competition, judge } = await createJudge(false)
    await app.request(`/api/v1/competitions/${competition.id}/judges/${judge.id}/revoke`, {
      method: 'POST',
      headers: authHeaders(organizerToken),
    })
    const response = await app.request(`/api/v1/judge/access/${judge.accessToken}`)
    expect(response.status).toBe(404)
  })
})

describe('POST /judge/auth', () => {
  it('refuse un jeton invalide', async () => {
    const response = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'pas-un-jeton-valide' }),
    })
    expect(response.status).toBe(404)
  })

  it('refuse un jeton révoqué', async () => {
    const { organizerToken, competition, judge } = await createJudge(false)
    await app.request(`/api/v1/competitions/${competition.id}/judges/${judge.id}/revoke`, {
      method: 'POST',
      headers: authHeaders(organizerToken),
    })
    const response = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: judge.accessToken }),
    })
    expect(response.status).toBe(404)
  })

  it('authentifie sans PIN quand la compétition ne l’exige pas', async () => {
    const { judge } = await createJudge(false)
    const response = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: judge.accessToken }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      token: string
      judge: { displayName: string; routes: Array<{ number: number }> }
    }
    expect(body.token).toBeTruthy()
    expect(body.judge.displayName).toBe('Juge Test')
    expect(body.judge.routes).toEqual([
      { id: expect.any(String), number: 1, name: null, holdCount: 40 },
    ])
  })

  it('refuse une authentification sans PIN quand la compétition l’exige (400)', async () => {
    const { judge } = await createJudge(true)
    const response = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: judge.accessToken }),
    })
    expect(response.status).toBe(400)
  })

  it('refuse un PIN incorrect', async () => {
    const { judge } = await createJudge(true)
    const response = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: judge.accessToken, pin: '000000' }),
    })
    expect(response.status).toBe(401)
  })

  it('authentifie avec le bon PIN', async () => {
    const { judge } = await createJudge(true)
    const response = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: judge.accessToken, pin: judge.pin }),
    })
    expect(response.status).toBe(200)
  })

  it('bloque après 5 tentatives de PIN erronées, puis refuse même le bon PIN pendant le blocage', async () => {
    const { judge } = await createJudge(true)
    const wrongAttempt = () =>
      app.request('/api/v1/judge/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: judge.accessToken, pin: '000000' }),
      })

    for (let i = 0; i < 4; i += 1) {
      const response = await wrongAttempt()
      expect(response.status).toBe(401)
    }
    const fifth = await wrongAttempt()
    expect(fifth.status).toBe(423)

    const correctPinWhileLocked = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: judge.accessToken, pin: judge.pin }),
    })
    expect(correctPinWhileLocked.status).toBe(423)
  })
})

describe('GET /judge/me', () => {
  async function authenticatedJudgeToken(pinRequired: boolean) {
    const setup = await createJudge(pinRequired)
    const response = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: setup.judge.accessToken, pin: setup.judge.pin }),
    })
    const body = (await response.json()) as { token: string }
    return { ...setup, judgeJwt: body.token }
  }

  it('renvoie l’identité et les voies du juge authentifié', async () => {
    const { judgeJwt } = await authenticatedJudgeToken(false)
    const response = await app.request('/api/v1/judge/me', {
      headers: { authorization: `Bearer ${judgeJwt}` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { displayName: string }
    expect(body.displayName).toBe('Juge Test')
  })

  it('refuse un jeton manquant', async () => {
    const response = await app.request('/api/v1/judge/me')
    expect(response.status).toBe(401)
  })

  it('déconnecte un juge révoqué au prochain appel, même avec un JWT non expiré', async () => {
    const {
      organizerToken,
      competition,
      judge: createdJudge,
      judgeJwt,
    } = await authenticatedJudgeToken(false)

    await app.request(`/api/v1/competitions/${competition.id}/judges/${createdJudge.id}/revoke`, {
      method: 'POST',
      headers: authHeaders(organizerToken),
    })

    const response = await app.request('/api/v1/judge/me', {
      headers: { authorization: `Bearer ${judgeJwt}` },
    })
    expect(response.status).toBe(401)
  })
})
