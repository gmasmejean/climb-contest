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
import { authHeaders, authenticateJudge, createJudgeFixture, judgeAuthHeaders } from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>
let fakeNow: Date

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
  fakeNow = new Date()
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    now: () => fakeNow,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
})

async function getActivityLog(accessToken: string, competitionId: string, query = '') {
  return app.request(`/api/v1/competitions/${competitionId}/activity-log${query}`, {
    headers: authHeaders(accessToken),
  })
}

describe('GET /competitions/:id/activity-log', () => {
  it('inclut la saisie juge normale et le changement de statut de tour, triés du plus récent au plus ancien', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    const routeDetail = (await (
      await app.request(`/api/v1/judge/routes/${fixture.route.id}`, { headers: judgeAuthHeaders(judgeJwt) })
    ).json()) as { round: { id: string } }

    await app.request('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: judgeAuthHeaders(judgeJwt),
      body: JSON.stringify({
        items: [
          {
            kind: 'create',
            id: crypto.randomUUID(),
            roundId: routeDetail.round.id,
            routeId: fixture.route.id,
            competitorId: fixture.competitor.id,
            holdNumber: 20,
            modifier: 'none',
            isTop: false,
            status: 'valid',
            climbTimeMs: null,
            recordedAt: fakeNow.toISOString(),
            deviceId: 'device-1',
          },
        ],
      }),
    })

    fakeNow = new Date(fakeNow.getTime() + 60_000)
    await app.request(`/api/v1/competitions/${fixture.competition.id}/round-status/${routeDetail.round.id}`, {
      method: 'POST',
      headers: authHeaders(fixture.organizerToken),
      body: JSON.stringify({ status: 'closed', categoryIds: [fixture.category.id] }),
    })

    const body = (await (await getActivityLog(fixture.organizerToken, fixture.competition.id)).json()) as {
      entries: { type: string; actorType: string; actorLabel: string | null; createdAt: string }[]
    }
    // Le plus récent d'abord : la fermeture, la saisie, puis l'ouverture faite par la fixture
    // (ADR-065 : ouvrir une catégorie passe elle aussi par `round-status`, donc au journal).
    expect(body.entries.map((e) => e.type)).toEqual([
      'round_status_changed',
      'ascent_created',
      'round_status_changed',
    ])
    expect(body.entries[1]?.actorType).toBe('judge')
    expect(body.entries[1]?.actorLabel).toBe('Juge Test')
    expect(body.entries[0]?.actorType).toBe('organizer')
  })

  it('filtre par type', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: true })
    const roundsResponse = await app.request(`/api/v1/competitions/${fixture.competition.id}/rounds`, {
      headers: authHeaders(fixture.organizerToken),
    })
    const roundId = ((await roundsResponse.json()) as { id: string }[])[0]!.id
    await app.request(`/api/v1/competitions/${fixture.competition.id}/round-status/${roundId}`, {
      method: 'POST',
      headers: authHeaders(fixture.organizerToken),
      body: JSON.stringify({ status: 'closed', categoryIds: [fixture.category.id] }),
    })

    const body = (await (
      await getActivityLog(fixture.organizerToken, fixture.competition.id, '?type=round_status_changed')
    ).json()) as { entries: { type: string }[] }
    // La fixture (`openRound: true`) a déjà ouvert le tour — un premier
    // `round_status_changed` (draft→open) existe avant celui de ce test
    // (open→closed).
    expect(body.entries).toHaveLength(2)
    expect(body.entries.every((e) => e.type === 'round_status_changed')).toBe(true)
  })

  it('exporte en CSV', async () => {
    const fixture = await createJudgeFixture(app, mailer, { format: 'phases', openRound: true })
    const roundsResponse = await app.request(`/api/v1/competitions/${fixture.competition.id}/rounds`, {
      headers: authHeaders(fixture.organizerToken),
    })
    const roundId = ((await roundsResponse.json()) as { id: string }[])[0]!.id
    await app.request(`/api/v1/competitions/${fixture.competition.id}/round-status/${roundId}`, {
      method: 'POST',
      headers: authHeaders(fixture.organizerToken),
      body: JSON.stringify({ status: 'closed', categoryIds: [fixture.category.id] }),
    })

    const response = await getActivityLog(fixture.organizerToken, fixture.competition.id, '?format=csv')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    const text = await response.text()
    expect(text.split('\n')[0]).toBe('"date","type","acteur","nom","motif","détail"')
    expect(text).toContain('round_status_changed')
  })
})
