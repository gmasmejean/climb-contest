import {
  ascent,
  applyPendingMigrations,
  createDatabase,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq, isNull, sql } from 'drizzle-orm'
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
  fakeNow = new Date('2026-09-18T14:03:00.000Z')
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
  syncedAt: string
  conflictGroup: string | null
}

interface BatchResultBody {
  id: string
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected'
  reason?: string
  conflictGroup?: string
  ascent?: AscentBody
  existing?: AscentBody
  incoming?: AscentBody
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

function createItem(
  fixture: JudgeFixture,
  roundId: string,
  overrides: Partial<{
    id: string
    competitorId: string
    holdNumber: number | null
    modifier: 'none' | 'plus'
    isTop: boolean
    status: 'valid' | 'dns' | 'dnf'
    climbTimeMs: number | null
    recordedAt: string
    deviceId: string
  }> = {},
) {
  return {
    kind: 'create' as const,
    id: overrides.id ?? crypto.randomUUID(),
    roundId,
    routeId: fixture.route.id,
    competitorId: overrides.competitorId ?? fixture.competitor.id,
    holdNumber: overrides.holdNumber !== undefined ? overrides.holdNumber : 25,
    modifier: overrides.modifier ?? 'none',
    isTop: overrides.isTop ?? false,
    status: overrides.status ?? 'valid',
    climbTimeMs: overrides.climbTimeMs ?? null,
    recordedAt: overrides.recordedAt ?? fakeNow.toISOString(),
    deviceId: overrides.deviceId ?? 'device-1',
  }
}

async function postBatch(judgeJwt: string, items: unknown[]) {
  return app.request('/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify({ items }),
  })
}

describe('POST /judge/ascents/batch', () => {
  it('accepte un item de création valide', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postBatch(judgeJwt, [createItem(fixture, roundId)])
    expect(response.status).toBe(200)
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results).toHaveLength(1)
    expect(body.results[0]?.status).toBe('accepted')
  })

  it('cas SPEC.md #21 : le même id envoyé deux fois (deux appels) donne une seule ligne, pas d’erreur', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const item = createItem(fixture, roundId, { holdNumber: 30 })

    const first = await postBatch(judgeJwt, [item])
    const firstBody = (await first.json()) as { results: BatchResultBody[] }
    expect(firstBody.results[0]?.status).toBe('accepted')

    const second = await postBatch(judgeJwt, [item])
    const secondBody = (await second.json()) as { results: BatchResultBody[] }
    expect(secondBody.results[0]?.status).toBe('duplicate')

    const rows = await handle.db.query.ascent.findMany({ where: eq(ascent.id, item.id) })
    expect(rows).toHaveLength(1)
  })

  it('cas SPEC.md #21 : le même id répété DANS le même lot est aussi idempotent', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const item = createItem(fixture, roundId, { holdNumber: 30 })

    const response = await postBatch(judgeJwt, [item, item])
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('accepted')
    expect(body.results[1]?.status).toBe('duplicate')

    const rows = await handle.db.query.ascent.findMany({ where: eq(ascent.id, item.id) })
    expect(rows).toHaveLength(1)
  })

  it('cas SPEC.md #22 : deux appareils, même triplet, valeurs différentes → les deux conservés avec un conflict_group commun', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const deviceA = createItem(fixture, roundId, { holdNumber: 20, deviceId: 'device-A' })
    const deviceB = createItem(fixture, roundId, { holdNumber: 28, deviceId: 'device-B' })

    const response = await postBatch(judgeJwt, [deviceA, deviceB])
    const body = (await response.json()) as { results: BatchResultBody[] }

    expect(body.results[0]?.status).toBe('accepted')
    expect(body.results[1]?.status).toBe('conflict')
    const conflictGroup = body.results[1]?.conflictGroup
    expect(conflictGroup).toBeTruthy()
    expect(body.results[1]?.existing?.holdNumber).toBe(20)
    expect(body.results[1]?.incoming?.holdNumber).toBe(28)

    const rows = await handle.db.query.ascent.findMany({
      where: and(eq(ascent.roundId, roundId), eq(ascent.competitorId, fixture.competitor.id)),
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.conflictGroup === conflictGroup)).toBe(true)
    // Aucune ligne ne reste dans l'index actif (ADR-002) : le triplet est
    // désormais en conflit, pas silencieusement résolu en faveur de l'une.
    const activeRows = rows.filter((row) => row.conflictGroup === null)
    expect(activeRows).toHaveLength(0)
  })

  it('cas SPEC.md #22 (course réelle) : deux LOTS concurrents pour un triplet tout neuf produisent un accepted et un conflict, jamais deux acceptés ni un rejected', async () => {
    // Contrairement au test ci-dessus (deux items dans le MÊME lot, traités
    // séquentiellement), ceci envoie deux requêtes HTTP réellement
    // concurrentes : `SELECT ... FOR UPDATE` ne verrouille rien tant
    // qu'aucune ligne n'existe encore pour ce triplet — les deux peuvent
    // passer la vérification avant que l'une n'ait inséré, puis se disputer
    // l'index partiel `ascent_active_key` (ADR-002) à l'INSERT.
    const { fixture, judgeJwt, roundId } = await setUp()
    const deviceA = createItem(fixture, roundId, { holdNumber: 20, deviceId: 'device-A' })
    const deviceB = createItem(fixture, roundId, { holdNumber: 28, deviceId: 'device-B' })

    const [responseA, responseB] = await Promise.all([
      postBatch(judgeJwt, [deviceA]),
      postBatch(judgeJwt, [deviceB]),
    ])
    const bodyA = (await responseA.json()) as { results: BatchResultBody[] }
    const bodyB = (await responseB.json()) as { results: BatchResultBody[] }
    const statuses = [bodyA.results[0]?.status, bodyB.results[0]?.status]

    // Peu importe qui gagne la course : exactement un accepted, un conflict —
    // jamais deux accepted (perdrait une saisie) ni un rejected (perdrait
    // silencieusement l'autre).
    expect(statuses.sort()).toEqual(['accepted', 'conflict'])

    const rows = await handle.db.query.ascent.findMany({
      where: and(eq(ascent.roundId, roundId), eq(ascent.competitorId, fixture.competitor.id)),
    })
    expect(rows).toHaveLength(2)
    expect([...new Set(rows.map((row) => row.conflictGroup))]).toHaveLength(1)
    expect(rows.map((row) => row.holdNumber).sort()).toEqual([20, 28])
  })

  it('un contenu identique sous un id différent est traité comme un duplicate, pas un conflit', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const first = createItem(fixture, roundId, { holdNumber: 25, deviceId: 'device-A' })
    const second = createItem(fixture, roundId, { holdNumber: 25, deviceId: 'device-B' })

    const response = await postBatch(judgeJwt, [first, second])
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('accepted')
    expect(body.results[1]?.status).toBe('duplicate')

    const rows = await handle.db.query.ascent.findMany({
      where: and(
        eq(ascent.roundId, roundId),
        eq(ascent.competitorId, fixture.competitor.id),
        isNull(ascent.conflictGroup),
      ),
    })
    expect(rows).toHaveLength(1)
  })

  it('cas SPEC.md #24 : recordedAt (saisie) et syncedAt (arrivée serveur) restent distincts', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    // « Saisi hors ligne à 14h03, remonté à 15h20 » (SPEC.md § 9 #24) : la
    // saisie a eu lieu il y a 77 minutes, réellement dans le passé par
    // rapport à l'horloge serveur qui timbre `synced_at` (`defaultNow()`,
    // colonne Postgres — indépendante du seam `now` applicatif).
    const recordedAt = new Date(Date.now() - 77 * 60 * 1000)

    const response = await postBatch(judgeJwt, [
      createItem(fixture, roundId, { recordedAt: recordedAt.toISOString() }),
    ])
    const body = (await response.json()) as { results: BatchResultBody[] }
    const created = body.results[0]?.ascent
    expect(created?.recordedAt).toBe(recordedAt.toISOString())
    expect(new Date(created?.syncedAt ?? 0).getTime()).toBeGreaterThan(recordedAt.getTime())
  })

  it('un item invalide au milieu d’un lot est rejected sans faire échouer les autres', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const other = await createJudgeFixture(app, mailer)
    const valid1 = createItem(fixture, roundId, { holdNumber: 20 })
    // Voie non assignée à ce juge — rejeté, mais ne doit pas bloquer le lot.
    const invalid = createItem(other, roundId, { holdNumber: 10 })
    const valid2 = createItem(fixture, roundId, {
      competitorId: fixture.competitor.id,
      holdNumber: 22,
    })

    const response = await postBatch(judgeJwt, [valid1, invalid, valid2])
    expect(response.status).toBe(200)
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('accepted')
    expect(body.results[1]?.status).toBe('rejected')
    expect(body.results[1]?.reason).toBeTruthy()
    // Le second item valide entre en conflit avec le premier (même triplet) —
    // preuve que le lot continue bien après l'item rejeté.
    expect(body.results[2]?.status).toBe('conflict')
  })

  it('corrige un passage via un supersedesId explicite, dans la fenêtre', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const original = createItem(fixture, roundId, { holdNumber: 20 })
    await postBatch(judgeJwt, [original])

    const correction = {
      kind: 'correct' as const,
      id: crypto.randomUUID(),
      supersedesId: original.id,
      holdNumber: 28,
      modifier: 'plus' as const,
      isTop: false,
      status: 'valid' as const,
      climbTimeMs: null,
    }
    const response = await postBatch(judgeJwt, [correction])
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('accepted')
    expect(body.results[0]?.ascent?.holdNumber).toBe(28)

    const originalRow = await handle.db.query.ascent.findFirst({
      where: eq(ascent.id, original.id),
    })
    expect(originalRow?.supersededBy).toBe(correction.id)
  })

  it('refuse une correction dont le supersedesId est introuvable', async () => {
    const { judgeJwt } = await setUp()
    const correction = {
      kind: 'correct' as const,
      id: crypto.randomUUID(),
      supersedesId: crypto.randomUUID(),
      holdNumber: 28,
      modifier: 'none' as const,
      isTop: false,
      status: 'valid' as const,
      climbTimeMs: null,
    }
    const response = await postBatch(judgeJwt, [correction])
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('rejected')
  })

  it('refuse une correction hors fenêtre de 5 minutes', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const original = createItem(fixture, roundId, { holdNumber: 20 })
    await postBatch(judgeJwt, [original])

    fakeNow = new Date(fakeNow.getTime() + 5 * 60 * 1000 + 1)

    const correction = {
      kind: 'correct' as const,
      id: crypto.randomUUID(),
      supersedesId: original.id,
      holdNumber: 28,
      modifier: 'none' as const,
      isTop: false,
      status: 'valid' as const,
      climbTimeMs: null,
    }
    const response = await postBatch(judgeJwt, [correction])
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('rejected')
  })

  it('renvoie toujours 200, même si tous les items sont rejected (jamais un 400 global)', async () => {
    const { judgeJwt } = await setUp()
    const other = await createJudgeFixture(app, mailer)
    const response = await postBatch(judgeJwt, [createItem(other, crypto.randomUUID())])
    expect(response.status).toBe(200)
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('rejected')
  })
})
