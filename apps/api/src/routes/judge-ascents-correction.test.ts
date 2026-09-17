import {
  ascent,
  ascentEvent,
  applyPendingMigrations,
  createDatabase,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authenticateJudge,
  createJudgeFixture,
  judgeAuthHeaders,
  type JudgeFixture,
} from '../test-utils/fixtures'

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
    // Seam de test (ADR-007) : contrôle la fenêtre de correction sans
    // dépendre d'un vrai délai de 5 minutes.
    now: () => fakeNow,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "ascent", "ascent_event", "judge", "judge_route" cascade`,
  )
})

interface AscentBody {
  id: string
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  recordedAt: string
}

async function setUp() {
  const fixture = await createJudgeFixture(app, mailer)
  const judgeJwt = await authenticateJudge(app, fixture.judge.accessToken, fixture.judge.pin)
  const routeDetailResponse = await app.request(`/api/v1/judge/routes/${fixture.route.id}`, {
    headers: judgeAuthHeaders(judgeJwt),
  })
  const routeDetail = (await routeDetailResponse.json()) as { round: { id: string } }
  return { fixture, judgeJwt, roundId: routeDetail.round.id }
}

function ascentPayload(fixture: JudgeFixture, roundId: string, holdNumber: number) {
  return {
    id: crypto.randomUUID(),
    roundId,
    routeId: fixture.route.id,
    competitorId: fixture.competitor.id,
    holdNumber,
    modifier: 'none' as const,
    isTop: false,
    status: 'valid' as const,
    climbTimeMs: null,
    recordedAt: fakeNow.toISOString(),
    deviceId: 'device-test-1',
  }
}

async function postAscent(judgeJwt: string, body: unknown) {
  return app.request('/api/v1/judge/ascents', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify(body),
  })
}

async function postCorrection(judgeJwt: string, body: unknown) {
  return app.request('/api/v1/judge/ascents/last/correct', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify(body),
  })
}

describe('POST /judge/ascents/last/correct', () => {
  it("refuse quand le juge n'a encore rien saisi", async () => {
    const { judgeJwt } = await setUp()
    const response = await postCorrection(judgeJwt, {
      id: crypto.randomUUID(),
      holdNumber: 20,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    })
    expect(response.status).toBe(404)
  })

  it('corrige la dernière saisie dans la fenêtre et chaîne `supersededBy`', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const original = await postAscent(judgeJwt, ascentPayload(fixture, roundId, 20))
    const originalBody = (await original.json()) as AscentBody

    const response = await postCorrection(judgeJwt, {
      id: crypto.randomUUID(),
      holdNumber: 25,
      modifier: 'plus',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    })
    expect(response.status).toBe(201)
    const corrected = (await response.json()) as AscentBody
    expect(corrected.holdNumber).toBe(25)
    expect(corrected.modifier).toBe('plus')
    // L'heure de l'événement ne change pas : une correction rectifie une
    // saisie déjà survenue (ADR-007), elle n'en crée pas une nouvelle.
    expect(corrected.recordedAt).toBe(originalBody.recordedAt)

    const originalRow = await handle.db.query.ascent.findFirst({
      where: eq(ascent.id, originalBody.id),
    })
    expect(originalRow?.supersededBy).toBe(corrected.id)
  })

  it('refuse une correction après la fenêtre de 5 minutes', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await postAscent(judgeJwt, ascentPayload(fixture, roundId, 20))

    fakeNow = new Date(fakeNow.getTime() + 5 * 60 * 1000 + 1)

    const response = await postCorrection(judgeJwt, {
      id: crypto.randomUUID(),
      holdNumber: 25,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    })
    expect(response.status).toBe(409)
  })

  it('refuse une correction après une saisie suivante sur un autre compétiteur', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await postAscent(judgeJwt, ascentPayload(fixture, roundId, 20))

    // Second compétiteur, même catégorie — l'organisateur en ajoute un.
    const secondCompetitorResponse = await app.request(
      `/api/v1/competitions/${fixture.competition.id}/competitors`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixture.organizerToken}`,
        },
        body: JSON.stringify({
          categoryId: fixture.category.id,
          bib: 2,
          firstName: 'Sacha',
          lastName: 'Dupont',
        }),
      },
    )
    const secondCompetitor = (await secondCompetitorResponse.json()) as { id: string }

    await postAscent(judgeJwt, {
      ...ascentPayload(fixture, roundId, 15),
      competitorId: secondCompetitor.id,
    })

    // La correction cible désormais la saisie sur le second compétiteur, pas
    // la première — la fenêtre de la première est fermée (ADR-007 : « jusqu'à
    // la saisie suivante, n'importe quel compétiteur »).
    const response = await postCorrection(judgeJwt, {
      id: crypto.randomUUID(),
      holdNumber: 30,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    })
    expect(response.status).toBe(201)
    const corrected = (await response.json()) as AscentBody & { competitorId?: string }
    // La correction a bien porté sur la DERNIÈRE saisie (second compétiteur),
    // pas sur la première.
    const correctedRow = await handle.db.query.ascent.findFirst({
      where: eq(ascent.id, corrected.id),
    })
    expect(correctedRow?.competitorId).toBe(secondCompetitor.id)
  })

  it('écrit deux événements `ascent_event` (`corrected` puis `created`)', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const original = await postAscent(judgeJwt, ascentPayload(fixture, roundId, 20))
    const originalBody = (await original.json()) as AscentBody

    const response = await postCorrection(judgeJwt, {
      id: crypto.randomUUID(),
      holdNumber: 25,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    })
    const corrected = (await response.json()) as AscentBody

    const originalEvents = await handle.db.query.ascentEvent.findMany({
      where: eq(ascentEvent.ascentId, originalBody.id),
    })
    expect(originalEvents.map((e) => e.eventType)).toEqual(['created', 'corrected'])

    const correctedEvents = await handle.db.query.ascentEvent.findMany({
      where: eq(ascentEvent.ascentId, corrected.id),
    })
    expect(correctedEvents.map((e) => e.eventType)).toEqual(['created'])
  })
})
