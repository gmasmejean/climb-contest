import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  applyPendingMigrations,
  asset,
  competitionDeletionLog,
  createDatabase,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { COMPETITION_OWNED_TABLES } from '../lib/competition-trash'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { LocalDiskStorage } from '../lib/storage'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authenticateJudge,
  authHeaders,
  createJudgeFixture,
  createTestCompetition,
  judgeAuthHeaders,
  registerLoggedInOrganizer,
  type JudgeFixture,
} from '../test-utils/fixtures'
import {
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
let storage: LocalDiskStorage
let storageRoot: string
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

beforeEach(async () => {
  mailer = new FakeMailer()
  fakeNow = new Date('2026-09-20T10:00:00.000Z')
  storageRoot = await mkdtemp(path.join(tmpdir(), 'climbcontest-trash-'))
  storage = new LocalDiskStorage(storageRoot)
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    now: () => fakeNow,
    storage,
    videoMaxBytes: 1024 * 1024,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "club", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "round_qualifier", "asset", "asset_upload", "ascent", "ascent_event", "activity_log", "judge", "judge_route", "competition_deletion_log" cascade`,
  )
  await rm(storageRoot, { recursive: true, force: true })
})

const url = (id: string) => `/api/v1/competitions/${id}`
const text = (value: string) => [...value].map((c) => c.charCodeAt(0))

function call(method: string, path: string, token: string): Promise<Response> {
  return Promise.resolve(app.request(path, { method, headers: authHeaders(token) }))
}
const trash = (id: string, token: string) => call('DELETE', url(id), token)
const restore = (id: string, token: string) => call('POST', `${url(id)}/restore`, token)
const permanently = (id: string, token: string) => call('DELETE', `${url(id)}/permanent`, token)

async function listIds(path: string, token: string): Promise<string[]> {
  const rows = await json<{ id: string }[]>(await call('GET', path, token))
  return rows.map((row) => row.id)
}
const activeIds = (token: string) => listIds('/api/v1/competitions', token)
const trashedIds = (token: string) => listIds('/api/v1/competitions/trash', token)

async function setStatus(id: string, token: string, status: string): Promise<void> {
  const response = await app.request(`${url(id)}/status`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ status }),
  })
  expect(response.status).toBe(200)
}

/** Une compétition de contest prête pour un juge, déjà clôturée : donc supprimable. */
async function closedFixture(): Promise<JudgeFixture> {
  const f = await createJudgeFixture(app, mailer)
  await setStatus(f.competition.id, f.organizerToken, 'closed')
  return f
}

async function logActions(competitionId: string): Promise<string[]> {
  const rows = await handle.db
    .select({ action: competitionDeletionLog.action })
    .from(competitionDeletionLog)
    .where(eq(competitionDeletionLog.competitionId, competitionId))
    .orderBy(competitionDeletionLog.createdAt, competitionDeletionLog.id)
  return rows.map((row) => row.action)
}

/** Un collègue du même club, rôle « organizer » (pas propriétaire). */
async function colleagueToken(owner: JudgeFixture): Promise<string> {
  const email = `collegue-${crypto.randomUUID()}@club.test`
  await app.request('/api/v1/auth/invitations', {
    method: 'POST',
    headers: authHeaders(owner.organizerToken),
    body: JSON.stringify({ email, displayName: 'Collègue', role: 'organizer' }),
  })
  await app.request('/api/v1/auth/invitations/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: mailer.lastTokenFor(email), password: 'un-mot-de-passe-solide' }),
  })
  const login = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'un-mot-de-passe-solide' }),
  })
  return ((await login.json()) as { accessToken: string }).accessToken
}

describe('mise à la corbeille', () => {
  it('retire la compétition de la liste et la range dans la corbeille', async () => {
    const f = await closedFixture()
    const id = f.competition.id

    const response = await trash(id, f.organizerToken)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { deletedAt: string }).deletedAt).toBe(fakeNow.toISOString())

    expect(await activeIds(f.organizerToken)).not.toContain(id)
    expect((await call('GET', url(id), f.organizerToken)).status).toBe(404)
    expect(await trashedIds(f.organizerToken)).toEqual([id])
    expect(await logActions(id)).toEqual(['trashed'])
  })

  it('refuse une compétition « En cours » et ne change rien', async () => {
    const f = await createJudgeFixture(app, mailer)
    const id = f.competition.id
    const response = await trash(id, f.organizerToken)
    expect(response.status).toBe(409)
    const body = (await response.json()) as { title: string; detail: string }
    expect(body.title).toBe('Compétition en cours')
    expect(body.detail).toContain('Clôturez-la')

    expect(await activeIds(f.organizerToken)).toContain(id)
    expect(await trashedIds(f.organizerToken)).toEqual([])
    expect(await logActions(id)).toEqual([])
  })

  it('accepte les autres statuts, « Ouverte » compris', async () => {
    const f = await createJudgeFixture(app, mailer)
    for (const status of ['draft', 'open', 'archived']) {
      await setStatus(f.competition.id, f.organizerToken, status)
      expect((await trash(f.competition.id, f.organizerToken)).status).toBe(200)
      expect((await restore(f.competition.id, f.organizerToken)).status).toBe(200)
    }
  })

  it('est ouverte à tout organisateur du club, pas seulement au propriétaire', async () => {
    const f = await closedFixture()
    const colleague = await colleagueToken(f)
    expect((await trash(f.competition.id, colleague)).status).toBe(200)
    expect(await trashedIds(colleague)).toEqual([f.competition.id])
    expect((await restore(f.competition.id, colleague)).status).toBe(200)
    expect((await trash(f.competition.id, colleague)).status).toBe(200)
    expect((await permanently(f.competition.id, colleague)).status).toBe(204)
  })

  it('répond 404 pour un autre club, sans rien révéler', async () => {
    const f = await closedFixture()
    const { accessToken: stranger } = await registerLoggedInOrganizer(app, mailer)
    expect((await trash(f.competition.id, stranger)).status).toBe(404)

    await trash(f.competition.id, f.organizerToken)
    expect((await restore(f.competition.id, stranger)).status).toBe(404)
    expect((await permanently(f.competition.id, stranger)).status).toBe(404)
    expect(await trashedIds(stranger)).toEqual([])
    // Rien n'a bougé pour le vrai propriétaire.
    expect(await trashedIds(f.organizerToken)).toEqual([f.competition.id])
  })

  it('exige d’être connecté', async () => {
    const f = await closedFixture()
    expect((await app.request(url(f.competition.id), { method: 'DELETE' })).status).toBe(401)
    expect((await app.request('/api/v1/competitions/trash')).status).toBe(401)
  })

  it('une deuxième mise à la corbeille répond 404 et n’ajoute pas de trace', async () => {
    const f = await closedFixture()
    await trash(f.competition.id, f.organizerToken)
    expect((await trash(f.competition.id, f.organizerToken)).status).toBe(404)
    expect(await logActions(f.competition.id)).toEqual(['trashed'])
  })
})

describe('restauration', () => {
  it('remet la compétition dans la liste, intacte', async () => {
    const f = await closedFixture()
    const id = f.competition.id
    await trash(id, f.organizerToken)

    const response = await restore(id, f.organizerToken)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { deletedAt: string | null }).deletedAt).toBeNull()

    expect(await activeIds(f.organizerToken)).toContain(id)
    expect(await trashedIds(f.organizerToken)).toEqual([])
    const detail = (await (await call('GET', url(id), f.organizerToken)).json()) as {
      status: string
    }
    expect(detail.status).toBe('closed')
    expect(await logActions(id)).toEqual(['trashed', 'restored'])
  })

  it('est idempotente : restaurer une compétition déjà active ne fait rien', async () => {
    const f = await closedFixture()
    const response = await restore(f.competition.id, f.organizerToken)
    expect(response.status).toBe(200)
    expect(await logActions(f.competition.id)).toEqual([])
  })

  it('répond 404 pour une compétition inconnue', async () => {
    const f = await closedFixture()
    expect((await restore(crypto.randomUUID(), f.organizerToken)).status).toBe(404)
  })
})

describe('accès juge et public pendant que la compétition est à la corbeille', () => {
  it('coupe le juge, puis le rétablit à la restauration', async () => {
    const f = await createJudgeFixture(app, mailer)
    const id = f.competition.id
    const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
    const detail = (await (
      await app.request(`/api/v1/judge/routes/${f.route.id}`, {
        headers: judgeAuthHeaders(judgeJwt),
      })
    ).json()) as { round: { id: string } }
    const batch = () =>
      app.request('/api/v1/judge/ascents/batch', {
        method: 'POST',
        headers: judgeAuthHeaders(judgeJwt),
        body: JSON.stringify({
          items: [
            {
              kind: 'create',
              id: crypto.randomUUID(),
              roundId: detail.round.id,
              routeId: f.route.id,
              competitorId: f.competitor.id,
              holdNumber: 12,
              modifier: 'none',
              isTop: false,
              status: 'valid',
              climbTimeMs: null,
              recordedAt: fakeNow.toISOString(),
              deviceId: 'device-trash',
            },
          ],
        }),
      })

    expect((await batch()).status).toBe(200)
    await setStatus(id, f.organizerToken, 'closed')
    await trash(id, f.organizerToken)

    // Une session juge déjà ouverte : refusée, avec un message qui rassure.
    const refused = await batch()
    expect(refused.status).toBe(404)
    const body = (await refused.json()) as { title: string; detail: string }
    expect(body.title).toBe('Compétition indisponible')
    expect(body.detail).toContain('Vos saisies restent enregistrées sur ce téléphone')
    expect(
      (await app.request('/api/v1/judge/me', { headers: judgeAuthHeaders(judgeJwt) })).status,
    ).toBe(404)

    // Le lien QR et l'identification ne marchent plus non plus, comme un lien inconnu.
    expect((await app.request(`/api/v1/judge/access/${f.judge.accessToken}`)).status).toBe(404)
    expect(
      (
        await app.request('/api/v1/judge/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: f.judge.accessToken, pin: f.judge.pin }),
        })
      ).status,
    ).toBe(404)

    // Restaurée : la même session juge repart, et le lien QR aussi.
    await restore(id, f.organizerToken)
    expect((await batch()).status).toBe(200)
    expect((await app.request(`/api/v1/judge/access/${f.judge.accessToken}`)).status).toBe(200)
  })

  it('coupe la page publique, puis la rétablit', async () => {
    const f = await closedFixture()
    const slug = String(f.competition['publicSlug'])
    expect((await app.request(`/api/v1/public/${slug}`)).status).toBe(200)

    await trash(f.competition.id, f.organizerToken)
    expect((await app.request(`/api/v1/public/${slug}`)).status).toBe(404)

    await restore(f.competition.id, f.organizerToken)
    expect((await app.request(`/api/v1/public/${slug}`)).status).toBe(200)
  })
})

describe('suppression définitive', () => {
  it('est refusée tant que la compétition n’est pas dans la corbeille', async () => {
    const f = await closedFixture()
    const response = await permanently(f.competition.id, f.organizerToken)
    expect(response.status).toBe(409)
    expect(((await response.json()) as { title: string }).title).toBe('Pas dans la corbeille')
    expect(await activeIds(f.organizerToken)).toContain(f.competition.id)
    expect(await logActions(f.competition.id)).toEqual([])
  })

  it('répond 404 pour une compétition inconnue', async () => {
    const f = await closedFixture()
    expect((await permanently(crypto.randomUUID(), f.organizerToken)).status).toBe(404)
  })

  /** Une ligne de plus dans CHAQUE table de la compétition : passages, tours, qualifiés, journal, vidéo… */
  async function populateEverything(s: PhasesScenario): Promise<string> {
    await playQualification(app, s)
    // Ouvrir la demi-finale fige la liste des qualifiés (`round_qualifier`).
    expect((await postRoundStatus(app, s, s.semifinalId, 'open')).status).toBe(200)

    const mp4 = new Uint8Array(400)
    mp4.set([0, 0, 0, 0x18, ...text('ftypisom')])
    const base = url(s.competitionId)
    const up = await app.request(`${base}/routes/${s.routeQ}/video/uploads`, {
      method: 'POST',
      headers: authHeaders(s.organizerToken),
      body: JSON.stringify({ sizeBytes: mp4.byteLength, mimeType: 'video/mp4' }),
    })
    const { uploadId } = (await up.json()) as { uploadId: string }
    await app.request(`${base}/routes/${s.routeQ}/video/uploads/${uploadId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${s.organizerToken}`, 'Upload-Offset': '0' },
      body: mp4,
    })
    const done = await app.request(
      `${base}/routes/${s.routeQ}/video/uploads/${uploadId}/complete`,
      {
        method: 'POST',
        headers: authHeaders(s.organizerToken),
      },
    )
    expect(done.status).toBe(201)

    const [videoAsset] = await handle.db
      .select({ storageKey: asset.storageKey })
      .from(asset)
      .where(eq(asset.competitionId, s.competitionId))
    if (!videoAsset) throw new Error('la vidéo aurait dû être enregistrée')
    return videoAsset.storageKey
  }

  async function rowCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const table of COMPETITION_OWNED_TABLES) {
      const result = await handle.db.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      )
      counts[table] = (result.rows[0] as { n: number }).n
    }
    return counts
  }

  it('efface tout — lignes et fichiers — sans toucher aux autres compétitions', async () => {
    // Un voisin, d'un autre club, avec ses propres données : il doit sortir intact.
    const neighbour = await setUpPhasesScenario(app, mailer, 2)
    await playQualification(app, neighbour)
    const neighbourCounts = await rowCounts()

    const doomed = await setUpPhasesScenario(app, mailer, 2)
    const storageKey = await populateEverything(doomed)
    const withDoomed = await rowCounts()
    // Ce qui appartient à la compétition supprimée, table par table. Le test ne
    // prouve quelque chose que si CHAQUE table contient des données à effacer.
    const doomedRows: Record<string, number> = {}
    for (const table of COMPETITION_OWNED_TABLES) {
      doomedRows[table] = (withDoomed[table] ?? 0) - (neighbourCounts[table] ?? 0)
      expect(doomedRows[table], `la table ${table} devrait être peuplée`).toBeGreaterThan(0)
    }

    // Une seconde compétition du MÊME club, elle aussi préservée.
    const sibling = await createTestCompetition(app, doomed.organizerToken, {
      startsOn: '2099-01-01',
      endsOn: '2099-01-01',
    })
    await app.request(`${url(sibling.id)}/categories`, {
      method: 'POST',
      headers: authHeaders(doomed.organizerToken),
      body: JSON.stringify({ label: 'U14', sex: 'X' }),
    })
    const everything = await rowCounts()
    expect(await storage.open(storageKey)).not.toBeNull()

    await setStatus(doomed.competitionId, doomed.organizerToken, 'closed')
    expect((await trash(doomed.competitionId, doomed.organizerToken)).status).toBe(200)
    // À la corbeille : rien n'est encore supprimé, ni en base ni sur le disque.
    expect(await rowCounts()).toEqual(everything)
    expect(await storage.open(storageKey)).not.toBeNull()

    expect((await permanently(doomed.competitionId, doomed.organizerToken)).status).toBe(204)

    // Plus rien de la compétition supprimée : ni fichier, ni ligne, ni page publique…
    expect(await storage.open(storageKey)).toBeNull()
    const remaining = await handle.db.execute(
      sql`select count(*)::int as n from competition where id = ${doomed.competitionId}`,
    )
    expect((remaining.rows[0] as { n: number }).n).toBe(0)
    expect(await trashedIds(doomed.organizerToken)).toEqual([])
    expect((await app.request(`/api/v1/public/${doomed.publicSlug}`)).status).toBe(404)

    // …et il reste exactement le reste : tout moins ce qui appartenait à la compétition.
    const after = await rowCounts()
    for (const table of COMPETITION_OWNED_TABLES) {
      expect(after[table], `${table} : lignes restantes`).toBe(
        (everything[table] ?? 0) - (doomedRows[table] ?? 0),
      )
    }
    expect(await activeIds(doomed.organizerToken)).toEqual([sibling.id])
    const siblingCategories = await json<unknown[]>(
      await call('GET', `${url(sibling.id)}/categories`, doomed.organizerToken),
    )
    expect(siblingCategories).toHaveLength(1)
    expect(await activeIds(neighbour.organizerToken)).toEqual([neighbour.competitionId])
  })

  it('garde une trace sans donnée personnelle, même après la suppression', async () => {
    const f = await closedFixture()
    const id = f.competition.id
    await trash(id, f.organizerToken)
    await permanently(id, f.organizerToken)

    const rows = await handle.db
      .select()
      .from(competitionDeletionLog)
      .where(eq(competitionDeletionLog.competitionId, id))
      .orderBy(competitionDeletionLog.createdAt)
    expect(rows.map((row) => row.action)).toEqual(['trashed', 'deleted'])
    expect(rows[1]).toMatchObject({
      competitionName: f.competition['name'],
      createdAt: fakeNow,
    })
    // Le nom de la compétition, l'identifiant de qui l'a fait : jamais un nom de compétiteur.
    expect(JSON.stringify(rows)).not.toContain('Léa')
    expect(JSON.stringify(rows)).not.toContain('Martin')
  })

  it('efface aussi les vidéos déjà retirées d’une voie', async () => {
    const s = await setUpPhasesScenario(app, mailer, 2)
    const storageKey = await populateEverything(s)
    await handle.db
      .update(asset)
      .set({ deletedAt: fakeNow })
      .where(eq(asset.storageKey, storageKey))

    await setStatus(s.competitionId, s.organizerToken, 'closed')
    await trash(s.competitionId, s.organizerToken)
    await permanently(s.competitionId, s.organizerToken)
    expect(await storage.open(storageKey)).toBeNull()
  })
})

describe('le catalogue de la base et la liste des tables supprimées', () => {
  it('COMPETITION_OWNED_TABLES contient exactement les tables qui dépendent d’une compétition', async () => {
    // Aucune clé étrangère n'a de `ON DELETE CASCADE` : une table qui référence
    // une compétition (directement ou via une autre table) et qui manque à la
    // liste ferait échouer — ou pire, laisserait — sa suppression.
    const result = await handle.db.execute(sql`
      with recursive owned(tbl) as (
        select c.conrelid::regclass::text
          from pg_constraint c
         where c.contype = 'f' and c.confrelid = 'competition'::regclass
        union
        select c.conrelid::regclass::text
          from pg_constraint c
          join owned o on c.confrelid = o.tbl::regclass
         where c.contype = 'f'
      )
      select tbl from owned
    `)
    const inDatabase = result.rows.map((row) => (row as { tbl: string }).tbl).sort()
    expect(inDatabase).toEqual([...COMPETITION_OWNED_TABLES].sort())
  })
})
