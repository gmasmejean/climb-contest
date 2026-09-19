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
import { authHeaders, registerLoggedInOrganizer } from '../test-utils/fixtures'
import {
  json,
  playQualification,
  postRoundStatus,
  setUpPhasesScenario,
} from '../test-utils/phases-scenario'

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

function get(path: string, token: string | null) {
  return app.request(path, { headers: token ? authHeaders(token) : {} })
}

describe('GET /competitions/:id/exports/results.csv', () => {
  it('exporte une ligne par compétiteur, dans l’ordre du classement, avec le bon en-tête', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    await playQualification(app, s)

    const response = await get(
      `/api/v1/competitions/${s.competitionId}/exports/results.csv`,
      s.organizerToken,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="resultats-.+\.csv"$/,
    )
    const lines = (await response.text()).replace('﻿', '').trim().split('\r\n')
    expect(lines[0]).toBe('categorie;rang;dossard;nom;prenom;club;tour_atteint;detail;provisoire')
    expect(lines).toHaveLength(5)
    expect(lines.slice(1).map((line) => line.split(';')[2])).toEqual(['1', '2', '3', '4'])
    expect(lines[1]).toContain('Qualification voie 1 : prise 30')
    expect(lines[1]!.endsWith(';oui')).toBe(true)
  })

  it('donne le même classement que la page publique (une seule source)', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    await playQualification(app, s)

    const csv = await (
      await get(`/api/v1/competitions/${s.competitionId}/exports/results.csv`, s.organizerToken)
    ).text()
    const publicRanking = await json<{ entries: { rank: number; bib: number }[] }>(
      await app.request(`/api/v1/public/${s.publicSlug}/rankings?category=${s.categoryId}`),
    )

    const csvPairs = csv
      .replace('﻿', '')
      .trim()
      .split('\r\n')
      .slice(1)
      .map((line) => [Number(line.split(';')[1]), Number(line.split(';')[2])])
    expect(csvPairs).toEqual(publicRanking.entries.map((e) => [e.rank, e.bib]))
  })

  it('ne contient que le contenu de la page publique : jamais de licence ni d’année de naissance', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    await app.request(
      `/api/v1/competitions/${s.competitionId}/competitors/${s.competitors[0]!.id}`,
      {
        method: 'PATCH',
        headers: authHeaders(s.organizerToken),
        body: JSON.stringify({ licenseNumber: 'LIC-SECRET-42', birthYear: 2011 }),
      },
    )
    await playQualification(app, s)

    const csv = await (
      await get(`/api/v1/competitions/${s.competitionId}/exports/results.csv`, s.organizerToken)
    ).text()

    expect(csv).not.toContain('LIC-SECRET-42')
    expect(csv).not.toContain('2011')
  })

  it('filtre sur une catégorie, et refuse une catégorie inconnue ou mal formée', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    await playQualification(app, s)
    const base = `/api/v1/competitions/${s.competitionId}/exports/results.csv`

    const one = await get(`${base}?category=${s.categoryId}`, s.organizerToken)
    expect(one.status).toBe(200)

    const unknown = await get(
      `${base}?category=00000000-0000-4000-8000-000000000000`,
      s.organizerToken,
    )
    expect(unknown.status).toBe(404)

    const malformed = await get(`${base}?category=pas-un-uuid`, s.organizerToken)
    expect(malformed.status).toBe(400)
  })

  it('passe à « non » une fois tous les tours publiés', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    await playQualification(app, s)
    expect((await postRoundStatus(app, s, s.qualificationId, 'published')).status).toBe(200)

    const csv = await (
      await get(`/api/v1/competitions/${s.competitionId}/exports/results.csv`, s.organizerToken)
    ).text()

    expect(csv.trim().split('\r\n')[1]!.endsWith(';non')).toBe(true)
  })
})

describe('GET /competitions/:id/exports/results.pdf', () => {
  it('renvoie un PDF téléchargeable', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    await playQualification(app, s)

    const response = await get(
      `/api/v1/competitions/${s.competitionId}/exports/results.pdf`,
      s.organizerToken,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="resultats-.+\.pdf"$/,
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })
})

describe('accès aux exports', () => {
  it.each(['results.csv', 'results.pdf'])('%s exige une authentification', async (file) => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    const response = await get(`/api/v1/competitions/${s.competitionId}/exports/${file}`, null)
    expect(response.status).toBe(401)
  })

  it.each(['results.csv', 'results.pdf'])(
    '%s d’une compétition d’un autre club répond 404, jamais 403',
    async (file) => {
      const s = await setUpPhasesScenario(app, mailer, 2)
      const other = await registerLoggedInOrganizer(app, mailer)
      const response = await get(
        `/api/v1/competitions/${s.competitionId}/exports/${file}`,
        other.accessToken,
      )
      expect(response.status).toBe(404)
    },
  )

  it('un jeton juge ne donne accès à aucun export', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    const response = await get(
      `/api/v1/competitions/${s.competitionId}/exports/results.csv`,
      s.judgeJwt,
    )
    expect(response.status).toBe(401)
  })
})
