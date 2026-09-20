import { competitionBackupSchema, type CompetitionBackup } from '@climbcontest/contracts'
import {
  applyPendingMigrations,
  ascent,
  ascentEvent,
  competition,
  createDatabase,
  judge,
  round,
  roundCategory,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { FakeMailer } from '../test-utils/fake-mailer'
import { authHeaders, registerLoggedInOrganizer } from '../test-utils/fixtures'
import {
  enterAscent,
  json,
  playQualification,
  postRoundStatus,
  setUpPhasesScenario,
  type PhasesScenario,
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

const exportUrl = (s: PhasesScenario) =>
  `/api/v1/competitions/${s.competitionId}/exports/competition.json`

async function exportBackup(
  s: PhasesScenario,
): Promise<{ text: string; backup: CompetitionBackup }> {
  const response = await app.request(exportUrl(s), { headers: authHeaders(s.organizerToken) })
  expect(response.status).toBe(200)
  const text = await response.text()
  return { text, backup: competitionBackupSchema.parse(JSON.parse(text)) }
}

function postImport(token: string | null, body: unknown, raw = false) {
  return app.request('/api/v1/competitions/import', {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

/** Qualification jouée, demi-finale ouverte (qualifiés figés), un passage corrigé (chaîne `superseded_by`). */
async function richScenario(): Promise<PhasesScenario> {
  const s = await setUpPhasesScenario(app, mailer, 2)
  await playQualification(app, s)
  expect((await postRoundStatus(app, s, s.semifinalId, 'open')).status).toBe(200)
  await enterAscent(app, s, s.semifinalId, s.routeS, s.competitors[0]!.id, 35)

  const rows = await json<{ bib: number; ascent: { id: string } | null }[]>(
    await app.request(
      `/api/v1/competitions/${s.competitionId}/ascents?roundId=${s.qualificationId}&routeId=${s.routeQ}`,
      { headers: authHeaders(s.organizerToken) },
    ),
  )
  const corrected = await app.request(
    `/api/v1/competitions/${s.competitionId}/ascents/${rows.find((r) => r.bib === 4)!.ascent!.id}`,
    {
      method: 'PATCH',
      headers: authHeaders(s.organizerToken),
      body: JSON.stringify({
        holdNumber: 12,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        reason: 'Erreur de saisie',
      }),
    },
  )
  expect(corrected.status).toBe(200)
  return s
}

async function publicEntries(slug: string, categoryId: string) {
  const ranking = await json<{ entries: unknown[] }>(
    await app.request(`/api/v1/public/${slug}/rankings?category=${categoryId}`),
  )
  return ranking.entries
}

describe('GET /competitions/:id/exports/competition.json', () => {
  it('renvoie une sauvegarde valide, téléchargeable', async () => {
    const s = await richScenario()

    const response = await app.request(exportUrl(s), { headers: authHeaders(s.organizerToken) })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="sauvegarde-.+-2026-09-19\.json"$/,
    )
    const backup = competitionBackupSchema.parse(await response.json())
    expect(backup.categories).toHaveLength(1)
    expect(backup.competitors).toHaveLength(4)
    expect(backup.roundQualifiers).toHaveLength(2)
    // 4 saisies de qualification + 1 de demi-finale + 1 correction = 6 lignes.
    expect(backup.ascents).toHaveLength(6)
    expect(backup.ascents.filter((a) => a.supersededBy !== null)).toHaveLength(1)
  })

  it('ne contient AUCUN secret : ni jeton juge, ni hachage, ni slug public', async () => {
    const s = await richScenario()
    const judgeRow = (await handle.db.select().from(judge))[0]!
    const { text } = await exportBackup(s)

    expect(judgeRow.accessTokenPlain).toBeTruthy()
    expect(text).not.toContain(judgeRow.accessTokenPlain!)
    expect(text).not.toContain(judgeRow.accessTokenHash)
    expect(text).not.toContain(judgeRow.accessTokenPrefix)
    expect(text).not.toContain(s.publicSlug)
    expect(text).not.toMatch(/accessToken|pinHash|passwordHash|refreshToken|pinPlain/i)
  })

  it('exige une authentification, et 404 pour une compétition d’un autre club', async () => {
    const s = await richScenario()
    expect((await app.request(exportUrl(s))).status).toBe(401)
    const other = await registerLoggedInOrganizer(app, mailer)
    expect(
      (await app.request(exportUrl(s), { headers: authHeaders(other.accessToken) })).status,
    ).toBe(404)
    expect((await app.request(exportUrl(s), { headers: authHeaders(s.judgeJwt) })).status).toBe(401)
  })
})

describe('POST /competitions/import', () => {
  it('aller-retour : la copie donne le même classement public, sans toucher à l’original', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)
    const before = await handle.db.select().from(ascent)

    const response = await postImport(s.organizerToken, { mode: 'commit', backup })

    expect(response.status).toBe(201)
    const { competitionId: copyId } = await json<{ competitionId: string }>(response)
    expect(copyId).not.toBe(s.competitionId)

    // Classement public identique.
    const copy = await json<{ publicSlug: string; name: string }>(
      await app.request(`/api/v1/competitions/${copyId}`, {
        headers: authHeaders(s.organizerToken),
      }),
    )
    expect(copy.publicSlug).not.toBe(s.publicSlug)
    const categoriesOfCopy = await json<{ id: string }[]>(
      await app.request(`/api/v1/competitions/${copyId}/categories`, {
        headers: authHeaders(s.organizerToken),
      }),
    )
    const originalEntries = await publicEntries(s.publicSlug, s.categoryId)
    const copyEntries = await publicEntries(copy.publicSlug, categoriesOfCopy[0]!.id)
    const strip = (entries: unknown[]) =>
      (
        entries as {
          rank: number
          bib: number
          firstName: string
          rounds: { routes: { holdNumber: number | null }[] }[]
        }[]
      ).map((e) => ({
        rank: e.rank,
        bib: e.bib,
        firstName: e.firstName,
        holds: e.rounds.map((r) => r.routes.map((x) => x.holdNumber)),
      }))
    expect(originalEntries.length).toBeGreaterThan(0)
    expect(strip(copyEntries)).toEqual(strip(originalEntries))

    // Même nombre de lignes partout, chaîne de corrections comprise.
    const copyAscents = await handle.db
      .select()
      .from(ascent)
      .where(eq(ascent.competitionId, copyId))
    expect(copyAscents).toHaveLength(6)
    expect(copyAscents.filter((a) => a.supersededBy !== null)).toHaveLength(1)
    const supersededTarget = copyAscents.find((a) => a.supersededBy !== null)!.supersededBy
    expect(copyAscents.some((a) => a.id === supersededTarget)).toBe(true)
    const originalIds = new Set(before.map((a) => a.id))
    expect(copyAscents.every((a) => !originalIds.has(a.id))).toBe(true)

    // Les qualifiés figés sont restaurés pour le bon tour de la copie.
    const copyRounds = await json<{ id: string; type: string }[]>(
      await app.request(`/api/v1/competitions/${copyId}/rounds`, {
        headers: authHeaders(s.organizerToken),
      }),
    )
    const copySemifinal = copyRounds.find((r) => r.type === 'semifinal')!
    const qualifiers = await json<{
      categories: { count: number; competitors: { bib: number }[] }[]
    }>(
      await app.request(
        `/api/v1/competitions/${copyId}/round-status/${copySemifinal.id}/qualifiers`,
        { headers: authHeaders(s.organizerToken) },
      ),
    )
    expect(qualifiers.categories[0]!.competitors.map((c) => c.bib)).toEqual([1, 2])

    // L'original n'a pas bougé.
    expect(
      await handle.db.select().from(ascent).where(eq(ascent.competitionId, s.competitionId)),
    ).toHaveLength(6)
  })

  it('relit une sauvegarde au format 1 : l’ancien statut du tour est répliqué sur ses catégories (ADR-065)', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)
    // Ce qu'écrivait l'application avant ADR-065 : le statut sur le tour, pas de `roundCategories`.
    const { roundCategories, ...rest } = backup
    const v1 = {
      ...rest,
      schemaVersion: 1,
      rounds: backup.rounds.map((r) => ({
        ...r,
        status: roundCategories.find((rc) => rc.roundId === r.id)?.status ?? 'draft',
      })),
    }

    const preview = await postImport(s.organizerToken, { mode: 'preview', backup: v1 })
    expect(preview.status).toBe(200)

    const response = await postImport(s.organizerToken, { mode: 'commit', backup: v1 })
    expect(response.status).toBe(201)
    const { competitionId: copyId } = await json<{ competitionId: string }>(response)

    const restored = await handle.db
      .select({ type: round.type, status: roundCategory.status })
      .from(roundCategory)
      .innerJoin(round, eq(round.id, roundCategory.roundId))
      .where(eq(round.competitionId, copyId))
    // Qualification jouée puis fermée, demi-finale ouverte : un état par catégorie (une seule ici).
    expect(restored).toHaveLength(2)
    expect(restored).toEqual(
      expect.arrayContaining([
        { type: 'qualification', status: 'closed' },
        { type: 'semifinal', status: 'open' },
      ]),
    )
  })

  it('l’export écrit le statut par catégorie (format 2), sans statut porté par le tour', async () => {
    const s = await richScenario()
    const { backup, text } = await exportBackup(s)

    expect(backup.schemaVersion).toBe(2)
    expect(backup.roundCategories).toHaveLength(2)
    expect(backup.roundCategories.map((rc) => rc.status).sort()).toEqual(['closed', 'open'])
    for (const r of JSON.parse(text).rounds as Record<string, unknown>[]) {
      expect('status' in r).toBe(false)
    }
  })

  it('restaure les juges révoqués, avec un identifiant inutilisable', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)

    const { competitionId: copyId } = await json<{ competitionId: string }>(
      await postImport(s.organizerToken, { mode: 'commit', backup }),
    )

    const copiedJudges = await handle.db.select().from(judge).where(eq(judge.competitionId, copyId))
    expect(copiedJudges).toHaveLength(1)
    expect(copiedJudges[0]!.revokedAt).not.toBeNull()
    expect(copiedJudges[0]!.accessTokenPlain).toBeNull()
    expect(copiedJudges[0]!.pinHash).toBeNull()
    // Les passages gardent leur auteur : le juge de la copie.
    const attributed = await handle.db
      .select()
      .from(ascent)
      .where(and(eq(ascent.competitionId, copyId), isNotNull(ascent.recordedByJudgeId)))
    expect(attributed.every((a) => a.recordedByJudgeId === copiedJudges[0]!.id)).toBe(true)
  })

  it('remappe les identifiants contenus dans le journal des événements', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)
    const { competitionId: copyId } = await json<{ competitionId: string }>(
      await postImport(s.organizerToken, { mode: 'commit', backup }),
    )

    const copyAscentIds = new Set(
      (await handle.db.select().from(ascent).where(eq(ascent.competitionId, copyId))).map(
        (a) => a.id,
      ),
    )
    const events = await handle.db
      .select({ event: ascentEvent })
      .from(ascentEvent)
      .innerJoin(ascent, eq(ascent.id, ascentEvent.ascentId))
      .where(eq(ascent.competitionId, copyId))
    expect(events.length).toBeGreaterThan(0)
    for (const { event } of events) {
      expect(copyAscentIds.has(event.ascentId)).toBe(true)
      const supersededBy = (event.payload as { supersededBy?: string }).supersededBy
      if (supersededBy) expect(copyAscentIds.has(supersededBy)).toBe(true)
    }
  })

  it('peut être réimporté plusieurs fois dans la même base', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)

    const first = await postImport(s.organizerToken, { mode: 'commit', backup })
    const second = await postImport(s.organizerToken, { mode: 'commit', backup })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await handle.db.select().from(competition)).toHaveLength(3)
  })

  it('un aperçu ne crée rien et annonce ce qui ne sera pas restauré', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)

    const response = await postImport(s.organizerToken, { mode: 'preview', backup })

    expect(response.status).toBe(200)
    const preview = await json<{
      counts: { competitors: number; ascents: number }
      notices: string[]
    }>(response)
    expect(preview.counts).toMatchObject({ competitors: 4, ascents: 6 })
    expect(preview.notices.join(' ')).toContain('révoqués')
    expect(await handle.db.select().from(competition)).toHaveLength(1)
  })

  it('la copie appartient au club de celui qui importe, pas au club d’origine', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)
    const other = await registerLoggedInOrganizer(app, mailer)

    const response = await postImport(other.accessToken, { mode: 'commit', backup })

    expect(response.status).toBe(201)
    const { competitionId } = await json<{ competitionId: string }>(response)
    expect(
      (
        await app.request(`/api/v1/competitions/${competitionId}`, {
          headers: authHeaders(other.accessToken),
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await app.request(`/api/v1/competitions/${competitionId}`, {
          headers: authHeaders(s.organizerToken),
        })
      ).status,
    ).toBe(404)
  })

  describe('refus, sans rien écrire', () => {
    async function rejectedWith(mutate: (backup: CompetitionBackup) => unknown) {
      const s = await richScenario()
      const { backup } = await exportBackup(s)
      const response = await postImport(s.organizerToken, {
        mode: 'commit',
        backup: mutate(backup),
      })
      expect(await handle.db.select().from(competition)).toHaveLength(1)
      return { response, body: await json<{ title: string; detail: string }>(response) }
    }

    it('un fichier qui n’est pas une sauvegarde', async () => {
      const { response, body } = await rejectedWith(() => ({ hello: 'world' }))
      expect(response.status).toBe(400)
      expect(body.title).toBe('Fichier de sauvegarde invalide')
    })

    it('un autre numéro de version, avec un message qui le dit', async () => {
      const { response, body } = await rejectedWith((b) => ({ ...b, schemaVersion: 3 }))
      expect(response.status).toBe(400)
      expect(body.title).toBe('Sauvegarde non compatible')
      expect(body.detail).toContain('format 3')
      expect(body.detail).toContain('formats 1 et 2')
    })

    it('un dossard en double, en français', async () => {
      const { response, body } = await rejectedWith((b) => {
        b.competitors[1]!.bib = b.competitors[0]!.bib
        return b
      })
      expect(response.status).toBe(400)
      expect(body.title).toBe('Sauvegarde incohérente')
      expect(body.detail).toContain('Rien n’a été importé.')
      expect(body.detail).toContain('même dossard')
    })

    it('un passage qui référence un compétiteur absent', async () => {
      const { response, body } = await rejectedWith((b) => {
        b.ascents[0]!.competitorId = '00000000-0000-4000-8000-000000000000'
        return b
      })
      expect(response.status).toBe(400)
      expect(body.detail).toContain('absent du fichier')
    })

    it('un champ secret glissé dans le fichier', async () => {
      const { response } = await rejectedWith((b) => ({
        ...b,
        judges: b.judges.map((j) => ({ ...j, accessTokenHash: 'x' })),
      }))
      expect(response.status).toBe(400)
    })
  })

  it('exige un organisateur connecté : pas de jeton, jeton juge', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)
    expect((await postImport(null, { mode: 'commit', backup })).status).toBe(401)
    expect((await postImport(s.judgeJwt, { mode: 'commit', backup })).status).toBe(401)
    expect(await handle.db.select().from(competition)).toHaveLength(1)
  })

  it('refuse un mode inconnu', async () => {
    const s = await richScenario()
    const { backup } = await exportBackup(s)
    expect((await postImport(s.organizerToken, { mode: 'yolo', backup })).status).toBe(400)
  })

  it('refuse un corps de plus de 25 Mo (413)', async () => {
    const s = await richScenario()
    const huge = JSON.stringify({
      mode: 'preview',
      backup: { padding: 'x'.repeat(26 * 1024 * 1024) },
    })
    const response = await postImport(s.organizerToken, huge, true)
    expect(response.status).toBe(413)
    expect((await json<{ title: string }>(response)).title).toBe('Fichier trop volumineux')
  })
})
