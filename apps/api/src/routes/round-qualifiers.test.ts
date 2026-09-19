import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import type { RoundQualifiersResponse } from '@climbcontest/contracts'
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
  authenticateJudge,
  authHeaders,
  createTestCompetition,
  judgeAuthHeaders,
  registerLoggedInOrganizer,
} from '../test-utils/fixtures'

/**
 * ADR-054 — liste des qualifiés figée à l'ouverture du tour suivant, et
 * garde-fous de transition associés. Format phases : qualification (voie Q)
 * puis demi-finale (voie S), quatre compétiteurs de la même catégorie.
 */

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
    now: () => new Date('2026-09-19T10:00:00.000Z'),
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "round_qualifier", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
})

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

interface Scenario {
  organizerToken: string
  competitionId: string
  publicSlug: string
  categoryId: string
  qualificationId: string
  semifinalId: string
  routeQ: string
  routeS: string
  /** bib 1..4, dans cet ordre. */
  competitors: { id: string; bib: number }[]
  judgeJwt: string
}

async function setUp(qualifyingCount: number | null): Promise<Scenario> {
  const { accessToken: organizerToken } = await registerLoggedInOrganizer(app, mailer)
  const competition = await createTestCompetition(app, organizerToken, {
    format: 'phases',
    startsOn: '2099-01-01',
    endsOn: '2099-01-01',
  })
  const base = `/api/v1/competitions/${competition.id}`
  const post = (path: string, body: unknown, method = 'POST') =>
    app.request(`${base}${path}`, {
      method,
      headers: authHeaders(organizerToken),
      body: JSON.stringify(body),
    })

  const category = await json<{ id: string }>(await post('/categories', { label: 'U16', sex: 'X' }))

  const competitors: { id: string; bib: number }[] = []
  for (const bib of [1, 2, 3, 4]) {
    const created = await json<{ id: string }>(
      await post('/competitors', {
        categoryId: category.id,
        bib,
        firstName: `Prénom${bib}`,
        lastName: `Nom${bib}`,
      }),
    )
    competitors.push({ id: created.id, bib })
  }

  const routeIds: string[] = []
  for (const number of [1, 2]) {
    const created = await json<{ id: string }>(await post('/routes', { number, holdCount: 40, categoryIds: [] }))
    await post(`/routes/${created.id}`, { categoryIds: [category.id] }, 'PATCH')
    routeIds.push(created.id)
  }
  const [routeQ, routeS] = routeIds as [string, string]

  const qualification = await json<{ id: string }>(
    await post('/rounds', { type: 'qualification', style: 'onsight', qualifyingCount }),
  )
  const semifinal = await json<{ id: string }>(
    await post('/rounds', { type: 'semifinal', style: 'onsight' }),
  )
  await post(
    `/rounds/${qualification.id}/routes`,
    { assignments: [{ routeId: routeQ, categoryId: category.id }] },
    'PUT',
  )
  await post(
    `/rounds/${semifinal.id}/routes`,
    { assignments: [{ routeId: routeS, categoryId: category.id }] },
    'PUT',
  )

  const judge = await json<{ accessToken: string; pin?: string }>(
    await post('/judges', { displayName: 'Juge Test', routeIds: [routeQ, routeS] }),
  )
  const judgeJwt = await authenticateJudge(app, judge.accessToken, judge.pin)

  return {
    organizerToken,
    competitionId: competition.id,
    publicSlug: String(competition['publicSlug']),
    categoryId: category.id,
    qualificationId: qualification.id,
    semifinalId: semifinal.id,
    routeQ,
    routeS,
    competitors,
    judgeJwt,
  }
}

function postStatus(s: Scenario, roundId: string, status: string) {
  return app.request(`/api/v1/competitions/${s.competitionId}/round-status/${roundId}`, {
    method: 'POST',
    headers: authHeaders(s.organizerToken),
    body: JSON.stringify({ status }),
  })
}

async function enterAscent(
  s: Scenario,
  roundId: string,
  routeId: string,
  competitorId: string,
  holdNumber: number,
) {
  const response = await app.request('/api/v1/judge/ascents/batch', {
    method: 'POST',
    headers: judgeAuthHeaders(s.judgeJwt),
    body: JSON.stringify({
      items: [
        {
          kind: 'create',
          id: crypto.randomUUID(),
          roundId,
          routeId,
          competitorId,
          holdNumber,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: '2026-09-19T10:00:00.000Z',
          deviceId: 'device-test',
        },
      ],
    }),
  })
  const body = await json<{ results: { status: string; reason?: string }[] }>(response)
  return body.results[0]
}

/** Qualification jouée : la liste de départ dit bib 1 = prise 30, 2 = 25, 3 = 20, 4 = 10 (sauf `holds`). */
async function playQualification(s: Scenario, holds: number[] = [30, 25, 20, 10]) {
  expect((await postStatus(s, s.qualificationId, 'open')).status).toBe(200)
  for (const [index, competitor] of s.competitors.entries()) {
    const result = await enterAscent(s, s.qualificationId, s.routeQ, competitor.id, holds[index]!)
    expect(result?.status).toBe('accepted')
  }
  expect((await postStatus(s, s.qualificationId, 'closed')).status).toBe(200)
}

async function qualifiers(s: Scenario, roundId = s.semifinalId) {
  const response = await app.request(
    `/api/v1/competitions/${s.competitionId}/round-status/${roundId}/qualifiers`,
    { headers: authHeaders(s.organizerToken) },
  )
  expect(response.status).toBe(200)
  return json<RoundQualifiersResponse>(response)
}

async function judgeRouteCompetitorBibs(s: Scenario, routeId: string): Promise<number[]> {
  const response = await app.request(`/api/v1/judge/routes/${routeId}`, {
    headers: judgeAuthHeaders(s.judgeJwt),
  })
  const body = await json<{ competitors: { bib: number }[] }>(response)
  return body.competitors.map((c) => c.bib).sort((a, b) => a - b)
}

describe('figeage des qualifiés à l’ouverture du tour suivant (ADR-054)', () => {
  it('ouvrir la demi-finale fige les 2 premiers de la qualification, avec leur rang', async () => {
    const s = await setUp(2)
    await playQualification(s)

    expect((await postStatus(s, s.semifinalId, 'open')).status).toBe(200)

    const view = await qualifiers(s)
    const cat = view.categories[0]!
    expect(cat.count).toBe(2)
    expect(cat.requested).toBe(2)
    expect(cat.tiedAtCutoff).toBe(false)
    expect(cat.frozenAt).not.toBeNull()
    expect(cat.competitors.map((c) => [c.bib, c.sourceRank])).toEqual([
      [1, 1],
      [2, 2],
    ])
  })

  it('le juge ne voit en demi-finale que les qualifiés', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    expect(await judgeRouteCompetitorBibs(s, s.routeS)).toEqual([1, 2])
  })

  it('refuse d’ouvrir la demi-finale tant que la qualification n’est pas fermée', async () => {
    const s = await setUp(2)
    expect((await postStatus(s, s.qualificationId, 'open')).status).toBe(200)

    const response = await postStatus(s, s.semifinalId, 'open')

    expect(response.status).toBe(409)
    const body = await json<{ detail: string }>(response)
    expect(body.detail).toContain('Fermez d’abord « Qualification »')
  })

  it('refuse d’ouvrir la demi-finale si la qualification est encore en brouillon', async () => {
    const s = await setUp(2)

    const response = await postStatus(s, s.semifinalId, 'open')

    expect(response.status).toBe(409)
    expect((await json<{ title: string }>(response)).title).toBe('Tour précédent non terminé')
  })

  it('égalité à la limite : tous les ex aequo sont qualifiés et l’écart est signalé', async () => {
    const s = await setUp(2)
    // bib 2 et bib 3 à égalité à la prise 25, pile à la limite des 2 qualifiés.
    await playQualification(s, [30, 25, 25, 10])

    await postStatus(s, s.semifinalId, 'open')

    const cat = (await qualifiers(s)).categories[0]!
    expect(cat.requested).toBe(2)
    expect(cat.count).toBe(3)
    expect(cat.tiedAtCutoff).toBe(true)
    expect(cat.competitors.map((c) => c.bib).sort()).toEqual([1, 2, 3])
  })

  it('sans nombre de qualifiés sur le tour précédent, tous les classés passent', async () => {
    const s = await setUp(null)
    await playQualification(s)

    await postStatus(s, s.semifinalId, 'open')

    const cat = (await qualifiers(s)).categories[0]!
    expect(cat.requested).toBeNull()
    expect(cat.count).toBe(4)
    expect(cat.tiedAtCutoff).toBe(false)
  })

  it('un abandon après la qualification ne promeut personne (le cas du 11e)', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    // bib 2, qualifié à la limite, se blesse et abandonne.
    const withdrawn = await app.request(
      `/api/v1/competitions/${s.competitionId}/competitors/${s.competitors[1]!.id}/status`,
      {
        method: 'PATCH',
        headers: authHeaders(s.organizerToken),
        body: JSON.stringify({ status: 'withdrawn' }),
      },
    )
    expect(withdrawn.status).toBe(200)

    // La liste figée n'a pas bougé…
    expect((await qualifiers(s)).categories[0]!.competitors.map((c) => c.bib)).toEqual([1, 2])
    // …le juge ne voit plus l'abandon, mais bib 3 n'est PAS promu à sa place.
    expect(await judgeRouteCompetitorBibs(s, s.routeS)).toEqual([1])
    // …et le classement public montre toujours les deux mêmes qualifiés.
    const ranking = await json<{
      entries: { bib: number | null; rounds: { roundType: string }[] }[]
    }>(
      await app.request(
        `/api/v1/public/${s.publicSlug}/rankings?category=${s.categoryId}`,
      ),
    )
    const inSemifinal = ranking.entries
      .filter((e) => e.rounds.some((r) => r.roundType === 'semifinal'))
      .map((e) => e.bib)
      .sort()
    expect(inSemifinal).toEqual([1, 2])
  })

  it('une correction tardive de la qualification ne change pas la liste figée', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    // Le passage de bib 3 (prise 20) est corrigé en prise 39 : il passerait
    // devant bib 1 et 2 si la liste était recalculée.
    const routeQAscents = await json<{ id: string; competitor?: unknown; ascent: { id: string } | null; bib: number }[]>(
      await app.request(
        `/api/v1/competitions/${s.competitionId}/ascents?roundId=${s.qualificationId}&routeId=${s.routeQ}`,
        { headers: authHeaders(s.organizerToken) },
      ),
    )
    const ascentOfBib3 = routeQAscents.find((row) => row.bib === 3)!.ascent!
    const corrected = await app.request(
      `/api/v1/competitions/${s.competitionId}/ascents/${ascentOfBib3.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(s.organizerToken),
        body: JSON.stringify({
          holdNumber: 39,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          reason: 'Erreur de saisie du juge',
        }),
      },
    )
    expect(corrected.status).toBe(200)

    expect((await qualifiers(s)).categories[0]!.competitors.map((c) => c.bib)).toEqual([1, 2])
  })
})

describe('saisie hors de la liste figée', () => {
  it('le lot juge refuse un non-qualifié avec un motif lisible, sans rien écrire', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    const result = await enterAscent(s, s.semifinalId, s.routeS, s.competitors[3]!.id, 20)

    expect(result?.status).toBe('rejected')
    expect(result?.reason).toBe(
      'Ce compétiteur n’est pas qualifié pour ce tour : sa saisie n’a pas été enregistrée.',
    )
    expect(await judgeRouteCompetitorBibs(s, s.routeS)).toEqual([1, 2])
  })

  it('accepte un qualifié', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    const result = await enterAscent(s, s.semifinalId, s.routeS, s.competitors[0]!.id, 35)

    expect(result?.status).toBe('accepted')
  })

  it('l’endpoint de saisie unitaire historique refuse aussi un non-qualifié', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    const response = await app.request('/api/v1/judge/ascents', {
      method: 'POST',
      headers: judgeAuthHeaders(s.judgeJwt),
      body: JSON.stringify({
        id: crypto.randomUUID(),
        roundId: s.semifinalId,
        routeId: s.routeS,
        competitorId: s.competitors[3]!.id,
        holdNumber: 20,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        climbTimeMs: null,
        recordedAt: '2026-09-19T10:00:00.000Z',
        deviceId: 'device-test',
      }),
    })

    expect(response.status).toBe(409)
    expect((await json<{ title: string }>(response)).title).toBe('Compétiteur non qualifié')
  })

  it('la saisie de secours de l’organisateur refuse aussi un non-qualifié', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    const response = await app.request(`/api/v1/competitions/${s.competitionId}/ascents`, {
      method: 'POST',
      headers: authHeaders(s.organizerToken),
      body: JSON.stringify({
        roundId: s.semifinalId,
        routeId: s.routeS,
        competitorId: s.competitors[3]!.id,
        holdNumber: 20,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        climbTimeMs: null,
        recordedAt: '2026-09-19T10:00:00.000Z',
      }),
    })

    expect(response.status).toBe(409)
    expect((await json<{ title: string }>(response)).title).toBe('Compétiteur non qualifié')
  })
})

describe('réouverture et retour en brouillon', () => {
  it('refuse de rouvrir la qualification une fois la demi-finale ouverte', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    const response = await postStatus(s, s.qualificationId, 'open')

    expect(response.status).toBe(409)
    const body = await json<{ title: string; detail: string }>(response)
    expect(body.title).toBe('Réouverture impossible')
    expect(body.detail).toContain('« Demi-finale » est déjà ouvert')
  })

  it('remet une demi-finale vide en brouillon : la liste figée est effacée, puis la qualification peut être rouverte', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')

    expect((await postStatus(s, s.semifinalId, 'draft')).status).toBe(200)
    expect((await qualifiers(s)).categories[0]!.count).toBe(0)

    expect((await postStatus(s, s.qualificationId, 'open')).status).toBe(200)
  })

  it('refuse le retour en brouillon dès qu’un passage existe', async () => {
    const s = await setUp(2)
    await playQualification(s)
    await postStatus(s, s.semifinalId, 'open')
    await enterAscent(s, s.semifinalId, s.routeS, s.competitors[0]!.id, 35)

    const response = await postStatus(s, s.semifinalId, 'draft')

    expect(response.status).toBe(409)
    expect((await json<{ title: string }>(response)).title).toBe('Retour en brouillon impossible')
    expect((await qualifiers(s)).categories[0]!.count).toBe(2)
  })

  it('refuse le retour en brouillon depuis un tour publié (transition absente du graphe)', async () => {
    const s = await setUp(2)
    await playQualification(s)
    expect((await postStatus(s, s.qualificationId, 'published')).status).toBe(200)

    const response = await postStatus(s, s.qualificationId, 'draft')

    expect(response.status).toBe(409)
    expect((await json<{ title: string }>(response)).title).toBe('Transition impossible')
  })

  it('rouvrir puis refermer la qualification alors que la demi-finale est encore en brouillon ne fige rien', async () => {
    const s = await setUp(2)
    await playQualification(s)

    expect((await postStatus(s, s.qualificationId, 'open')).status).toBe(200)
    expect((await postStatus(s, s.qualificationId, 'closed')).status).toBe(200)

    expect((await qualifiers(s)).categories[0]!.count).toBe(0)
  })
})

describe('tours sans liste figée (compatibilité avec les tours ouverts avant le Lot 9)', () => {
  it('le premier tour d’une catégorie n’est pas restreint', async () => {
    const s = await setUp(2)
    await postStatus(s, s.qualificationId, 'open')

    expect(await judgeRouteCompetitorBibs(s, s.routeQ)).toEqual([1, 2, 3, 4])
  })

  it('la vue des qualifiés d’un premier tour est vide, sans erreur', async () => {
    const s = await setUp(2)

    const cat = (await qualifiers(s, s.qualificationId)).categories[0]!

    expect(cat.count).toBe(0)
    expect(cat.frozenAt).toBeNull()
  })
})
