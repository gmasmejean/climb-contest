import {
  ascent,
  ascentEvent,
  judge,
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
  authHeaders,
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

// Lot 21, ADR-078 — le lot d'un juge RÉVOQUÉ est reçu, mais mis en quarantaine.
describe('POST /judge/ascents/batch — accès révoqué (ADR-078)', () => {
  interface ConflictBody {
    conflictGroup: string
    kind: 'conflict' | 'revoked_access'
    ascents: { ascent: AscentBody; judgeDisplayName: string | null }[]
  }

  async function revoke(fixture: JudgeFixture): Promise<void> {
    const response = await app.request(
      `/api/v1/competitions/${fixture.competition.id}/judges/${fixture.judge.id}/revoke`,
      { method: 'POST', headers: authHeaders(fixture.organizerToken) },
    )
    expect(response.status).toBe(200)
  }

  async function listConflicts(fixture: JudgeFixture): Promise<ConflictBody[]> {
    const response = await app.request(`/api/v1/competitions/${fixture.competition.id}/conflicts`, {
      headers: authHeaders(fixture.organizerToken),
    })
    return (await response.json()) as ConflictBody[]
  }

  function resolve(fixture: JudgeFixture, conflictGroup: string, body: unknown) {
    return app.request(
      `/api/v1/competitions/${fixture.competition.id}/conflicts/${conflictGroup}/resolve`,
      { method: 'POST', headers: authHeaders(fixture.organizerToken), body: JSON.stringify(body) },
    )
  }

  function rescueEntry(fixture: JudgeFixture, roundId: string, holdNumber: number) {
    return app.request(`/api/v1/competitions/${fixture.competition.id}/ascents`, {
      method: 'POST',
      headers: authHeaders(fixture.organizerToken),
      body: JSON.stringify({
        roundId,
        routeId: fixture.route.id,
        competitorId: fixture.competitor.id,
        recordedAt: fakeNow.toISOString(),
        holdNumber,
        modifier: 'none',
        isTop: false,
        status: 'valid',
      }),
    })
  }

  function setRoundStatus(fixture: JudgeFixture, roundId: string, status: string) {
    return app.request(
      `/api/v1/competitions/${fixture.competition.id}/round-status/${roundId}`,
      {
        method: 'POST',
        headers: authHeaders(fixture.organizerToken),
        body: JSON.stringify({ status, categoryIds: [fixture.category.id] }),
      },
    )
  }

  async function activeRows(fixture: JudgeFixture) {
    return handle.db.query.ascent.findMany({
      where: and(
        eq(ascent.competitorId, fixture.competitor.id),
        isNull(ascent.supersededBy),
        isNull(ascent.conflictGroup),
      ),
    })
  }

  it('reçoit la saisie, la renvoie accepted avec accessRevoked, et la garde hors classement', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)

    const item = createItem(fixture, roundId, { holdNumber: 18 })
    const response = await postBatch(judgeJwt, [item])
    expect(response.status).toBe(200)
    const body = (await response.json()) as { results: BatchResultBody[]; accessRevoked?: boolean }
    expect(body.accessRevoked).toBe(true)
    expect(body.results[0]?.status).toBe('accepted')
    expect(body.results[0]?.ascent?.conflictGroup).not.toBeNull()

    // Durablement en base, mais jamais ligne active.
    expect(await handle.db.query.ascent.findMany({ where: eq(ascent.id, item.id) })).toHaveLength(1)
    expect(await activeRows(fixture)).toHaveLength(0)

    const conflicts = await listConflicts(fixture)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.kind).toBe('revoked_access')
    expect(conflicts[0]?.ascents).toHaveLength(1)

    // Le classement public ne voit aucun passage pour ce compétiteur.
    const ranking = (await (
      await app.request(
        `/api/v1/public/${fixture.competition.publicSlug as string}/rankings?category=${fixture.category.id}`,
      )
    ).json()) as { entries: { rounds: { routes: unknown[] }[] }[] }
    expect(ranking.entries.flatMap((entry) => entry.rounds.flatMap((r) => r.routes))).toEqual([])
  })

  it('un juge actif ne reçoit pas accessRevoked', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const response = await postBatch(judgeJwt, [createItem(fixture, roundId)])
    const body = (await response.json()) as { accessRevoked?: boolean }
    expect(body.accessRevoked).toBe(false)
  })

  it('toutes les autres routes juge restent en 401, avec le code judge_revoked', async () => {
    const { fixture, judgeJwt } = await setUp()
    await revoke(fixture)

    for (const path of ['/bootstrap', '/routes', `/routes/${fixture.route.id}`, '/ascents/last']) {
      const response = await app.request(`/api/v1/judge${path}`, {
        headers: judgeAuthHeaders(judgeJwt),
      })
      expect(response.status, path).toBe(401)
      expect(((await response.json()) as { code?: string }).code, path).toBe('judge_revoked')
    }
  })

  it('le rejeu du même lot par un accès révoqué reste idempotent', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    const item = createItem(fixture, roundId, { holdNumber: 18 })

    await postBatch(judgeJwt, [item])
    const second = await postBatch(judgeJwt, [item])
    const body = (await second.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('duplicate')
    expect(await listConflicts(fixture)).toHaveLength(1)
  })

  it('borne : une voie non assignée est rejetée, même pour un accès révoqué', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    const response = await postBatch(judgeJwt, [
      { ...createItem(fixture, roundId), routeId: crypto.randomUUID() },
    ])
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('rejected')
    expect(await listConflicts(fixture)).toHaveLength(0)
  })

  it('ne met pas à jour le « dernier signe de vie » du juge révoqué', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    const before = await handle.db.query.judge.findFirst({ where: eq(judge.id, fixture.judge.id) })
    fakeNow = new Date(fakeNow.getTime() + 60 * 60 * 1000)
    await postBatch(judgeJwt, [createItem(fixture, roundId)])
    const after = await handle.db.query.judge.findFirst({ where: eq(judge.id, fixture.judge.id) })
    expect(after?.lastSeenAt).toEqual(before?.lastSeenAt)
  })

  it('bloque la publication de la catégorie tant que la saisie n’est pas tranchée', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    await postBatch(judgeJwt, [createItem(fixture, roundId)])

    expect((await setRoundStatus(fixture, roundId, 'closed')).status).toBe(200)
    expect((await setRoundStatus(fixture, roundId, 'published')).status).toBe(409)
  })

  it('accepter : la saisie devient la ligne active, la publication passe', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    const item = createItem(fixture, roundId, { holdNumber: 18 })
    await postBatch(judgeJwt, [item])
    const [conflict] = await listConflicts(fixture)
    if (!conflict) throw new Error('quarantine missing')

    const response = await resolve(fixture, conflict.conflictGroup, {
      resolution: 'choose',
      ascentId: item.id,
    })
    expect(response.status).toBe(200)

    const active = await activeRows(fixture)
    expect(active.map((row) => row.id)).toEqual([item.id])
    expect(await listConflicts(fixture)).toHaveLength(0)
    await setRoundStatus(fixture, roundId, 'closed')
    expect((await setRoundStatus(fixture, roundId, 'published')).status).toBe(200)
  })

  it('refuser : motif obligatoire, la ligne reste en base, hors classement, et ne bloque plus rien', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    const item = createItem(fixture, roundId, { holdNumber: 18 })
    await postBatch(judgeJwt, [item])
    const [conflict] = await listConflicts(fixture)
    if (!conflict) throw new Error('quarantine missing')

    expect((await resolve(fixture, conflict.conflictGroup, { resolution: 'reject' })).status).toBe(400)
    const response = await resolve(fixture, conflict.conflictGroup, {
      resolution: 'reject',
      reason: 'Téléphone perdu, saisie non fiable',
    })
    expect(response.status).toBe(200)

    const [row] = await handle.db.query.ascent.findMany({ where: eq(ascent.id, item.id) })
    expect(row?.voidedAt).not.toBeNull()
    expect(row?.conflictGroup).toBe(conflict.conflictGroup)
    expect(await activeRows(fixture)).toHaveLength(0)
    expect(await listConflicts(fixture)).toHaveLength(0)

    const events = await handle.db.query.ascentEvent.findMany({
      where: eq(ascentEvent.ascentId, item.id),
    })
    expect(events.find((event) => event.eventType === 'voided')?.reason).toBe(
      'Téléphone perdu, saisie non fiable',
    )

    const dashboard = (await (
      await app.request(`/api/v1/competitions/${fixture.competition.id}/dashboard`, {
        headers: authHeaders(fixture.organizerToken),
      })
    ).json()) as { alerts: { type: string }[] }
    expect(dashboard.alerts.filter((alert) => alert.type === 'unresolved_conflict')).toHaveLength(0)

    // Une vraie saisie arrive ensuite normalement sur ce triplet : la ligne
    // refusée ne compte plus comme un groupe ouvert.
    const rescue = (await (await rescueEntry(fixture, roundId, 22)).json()) as { status: string }
    expect(rescue.status).toBe('accepted')
    expect(await activeRows(fixture)).toHaveLength(1)

    await setRoundStatus(fixture, roundId, 'closed')
    expect((await setRoundStatus(fixture, roundId, 'published')).status).toBe(200)
  })

  it('un vrai conflit (plusieurs valeurs) ne se refuse pas', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await postBatch(judgeJwt, [createItem(fixture, roundId, { holdNumber: 18 })])
    await revoke(fixture)
    // Valeur différente d'une ligne active → conflit ordinaire à deux.
    const response = await postBatch(judgeJwt, [createItem(fixture, roundId, { holdNumber: 30 })])
    const body = (await response.json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('conflict')

    const [conflict] = await listConflicts(fixture)
    expect(conflict?.kind).toBe('conflict')
    if (!conflict) throw new Error('conflict missing')
    expect(
      (await resolve(fixture, conflict.conflictGroup, { resolution: 'reject', reason: 'x' })).status,
    ).toBe(409)
  })

  it('invariant : une saisie de secours DIFFÉRENTE rejoint la quarantaine au lieu d’entrer au classement', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    await postBatch(judgeJwt, [createItem(fixture, roundId, { holdNumber: 18 })])

    const rescue = (await (await rescueEntry(fixture, roundId, 22)).json()) as { status: string }
    expect(rescue.status).toBe('conflict')
    expect(await activeRows(fixture)).toHaveLength(0)

    const conflicts = await listConflicts(fixture)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.kind).toBe('conflict')
    expect(conflicts[0]?.ascents).toHaveLength(2)
  })

  it('invariant : une saisie de secours IDENTIQUE confirme la valeur et résout la quarantaine', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    await revoke(fixture)
    const item = createItem(fixture, roundId, { holdNumber: 18 })
    await postBatch(judgeJwt, [item])

    const rescue = (await (await rescueEntry(fixture, roundId, 18)).json()) as {
      status: string
      ascent: AscentBody
    }
    expect(rescue.status).toBe('accepted')
    const active = await activeRows(fixture)
    expect(active.map((row) => row.id)).toEqual([rescue.ascent.id])
    expect(await listConflicts(fixture)).toHaveLength(0)

    const [quarantined] = await handle.db.query.ascent.findMany({ where: eq(ascent.id, item.id) })
    expect(quarantined?.supersededBy).toBe(rescue.ascent.id)
  })

  it('une 3ᵉ saisie pendant un conflit ouvert rejoint le groupe, et le conflit reste tranchable', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const first = createItem(fixture, roundId, { holdNumber: 18 })
    await postBatch(judgeJwt, [first])
    await postBatch(judgeJwt, [createItem(fixture, roundId, { holdNumber: 30, deviceId: 'device-2' })])

    const third = (await (await rescueEntry(fixture, roundId, 22)).json()) as { status: string }
    expect(third.status).toBe('conflict')

    const [conflict] = await listConflicts(fixture)
    expect(conflict?.ascents).toHaveLength(3)
    if (!conflict) throw new Error('conflict missing')
    const response = await resolve(fixture, conflict.conflictGroup, {
      resolution: 'choose',
      ascentId: first.id,
    })
    expect(response.status).toBe(200)
    expect((await activeRows(fixture)).map((row) => row.id)).toEqual([first.id])
  })

  it('correction dans la fenêtre : posée en conflit avec la saisie visée, rien n’est remplacé', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const original = createItem(fixture, roundId, { holdNumber: 18 })
    await postBatch(judgeJwt, [original])
    await revoke(fixture)

    fakeNow = new Date(fakeNow.getTime() + 60 * 1000)
    const correction = {
      kind: 'correct' as const,
      id: crypto.randomUUID(),
      supersedesId: original.id,
      holdNumber: 19,
      modifier: 'none' as const,
      isTop: false,
      status: 'valid' as const,
    }
    const body = (await (await postBatch(judgeJwt, [correction])).json()) as {
      results: BatchResultBody[]
    }
    expect(body.results[0]?.status).toBe('conflict')

    const [conflict] = await listConflicts(fixture)
    expect(conflict?.kind).toBe('conflict')
    expect(conflict?.ascents.map((entry) => entry.ascent.holdNumber).sort()).toEqual([18, 19])
    const [target] = await handle.db.query.ascent.findMany({ where: eq(ascent.id, original.id) })
    expect(target?.supersededBy).toBeNull()
  })

  it('correction hors fenêtre : rejetée comme pour tout juge, la saisie visée reste au classement', async () => {
    const { fixture, judgeJwt, roundId } = await setUp()
    const original = createItem(fixture, roundId, { holdNumber: 18 })
    await postBatch(judgeJwt, [original])
    await revoke(fixture)

    fakeNow = new Date(fakeNow.getTime() + 6 * 60 * 1000)
    const body = (await (
      await postBatch(judgeJwt, [
        {
          kind: 'correct',
          id: crypto.randomUUID(),
          supersedesId: original.id,
          holdNumber: 19,
          modifier: 'none',
          isTop: false,
          status: 'valid',
        },
      ])
    ).json()) as { results: BatchResultBody[] }
    expect(body.results[0]?.status).toBe('rejected')
    expect((await activeRows(fixture)).map((row) => row.id)).toEqual([original.id])
  })
})
