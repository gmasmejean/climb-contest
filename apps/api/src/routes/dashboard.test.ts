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
  // Vrai « maintenant », pas une date fixe : `judge-auth.ts` (connexion,
  // `lastSeenAt`) et `competitions.ts` (ouverture du round implicite) ne
  // reçoivent pas le seam `now` (non injecté dans ces deux routes) et
  // écrivent donc l'heure réelle — les tests d'alerte ci-dessous avancent
  // `fakeNow` depuis cette valeur de départ pour rester cohérents avec elle.
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

async function getDashboard(accessToken: string, competitionId: string) {
  const response = await app.request(`/api/v1/competitions/${competitionId}/dashboard`, {
    headers: authHeaders(accessToken),
  })
  return response
}

interface DashboardBody {
  categories: {
    categoryId: string
    routes: { routeId: string; done: number; expected: number; roundStatus: string }[]
  }[]
  competitorsPending: { competitorId: string; remainingRouteNumbers: number[] }[]
  judges: { judgeId: string; ascentCount: number }[]
  alerts: { type: string }[]
}

describe('GET /competitions/:id/dashboard', () => {
  it('progression à zéro sur un tour tout juste ouvert', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const response = await getDashboard(fixture.organizerToken, fixture.competition.id)
    expect(response.status).toBe(200)
    const body = (await response.json()) as DashboardBody
    expect(body.categories).toHaveLength(1)
    expect(body.categories[0]?.routes).toEqual([
      expect.objectContaining({ routeId: fixture.route.id, done: 0, expected: 1, roundStatus: 'open' }),
    ])
    expect(body.competitorsPending).toEqual([
      expect.objectContaining({ competitorId: fixture.competitor.id, remainingRouteNumbers: [1] }),
    ])
    expect(body.judges).toEqual([expect.objectContaining({ ascentCount: 0 })])
  })

  it('la progression avance après une saisie, et le compétiteur sort de la liste des restants', async () => {
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
            holdNumber: 25,
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

    const body = (await (await getDashboard(fixture.organizerToken, fixture.competition.id)).json()) as DashboardBody
    expect(body.categories[0]?.routes[0]).toEqual(
      expect.objectContaining({ done: 1, expected: 1 }),
    )
    expect(body.competitorsPending).toEqual([])
    expect(body.judges[0]?.ascentCount).toBe(1)
  })

  it('alerte « voie sans saisie depuis 15 minutes » quand le tour est ouvert et rien n’a été saisi', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    fakeNow = new Date(fakeNow.getTime() + 16 * 60 * 1000)

    const body = (await (await getDashboard(fixture.organizerToken, fixture.competition.id)).json()) as DashboardBody
    expect(body.alerts).toContainEqual(
      expect.objectContaining({ type: 'route_stalled', routeId: fixture.route.id }),
    )
  })

  it('pas d’alerte de voie muette avant 15 minutes', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    fakeNow = new Date(fakeNow.getTime() + 5 * 60 * 1000)

    const body = (await (await getDashboard(fixture.organizerToken, fixture.competition.id)).json()) as DashboardBody
    expect(body.alerts.filter((a) => a.type === 'route_stalled')).toHaveLength(0)
  })

  it('alerte « juge muet depuis 10 minutes »', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    fakeNow = new Date(fakeNow.getTime() + 11 * 60 * 1000)

    const body = (await (await getDashboard(fixture.organizerToken, fixture.competition.id)).json()) as DashboardBody
    expect(body.alerts).toContainEqual(
      expect.objectContaining({ type: 'judge_silent', judgeId: fixture.judge.id }),
    )
  })

  it('alerte de conflit non résolu', async () => {
    const fixture = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
    const routeDetail = (await (
      await app.request(`/api/v1/judge/routes/${fixture.route.id}`, { headers: judgeAuthHeaders(judgeJwt) })
    ).json()) as { round: { id: string } }
    const base = {
      kind: 'create' as const,
      roundId: routeDetail.round.id,
      routeId: fixture.route.id,
      competitorId: fixture.competitor.id,
      modifier: 'none' as const,
      isTop: false,
      status: 'valid' as const,
      climbTimeMs: null,
      recordedAt: fakeNow.toISOString(),
    }
    await app.request('/api/v1/judge/ascents/batch', {
      method: 'POST',
      headers: judgeAuthHeaders(judgeJwt),
      body: JSON.stringify({
        items: [
          { ...base, id: crypto.randomUUID(), holdNumber: 20, deviceId: 'device-A' },
          { ...base, id: crypto.randomUUID(), holdNumber: 28, deviceId: 'device-B' },
        ],
      }),
    })

    const body = (await (await getDashboard(fixture.organizerToken, fixture.competition.id)).json()) as DashboardBody
    expect(body.alerts).toContainEqual(expect.objectContaining({ type: 'unresolved_conflict' }))
  })

  it('alerte « compétiteur sans passage » une fois le tour fermé', async () => {
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

    const body = (await (await getDashboard(fixture.organizerToken, fixture.competition.id)).json()) as DashboardBody
    expect(body.alerts).toContainEqual(
      expect.objectContaining({ type: 'competitor_no_ascent', competitorId: fixture.competitor.id }),
    )
  })
})
