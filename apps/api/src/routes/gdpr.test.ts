import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  activityLog,
  applyPendingMigrations,
  ascent,
  ascentEvent,
  asset,
  assetUpload,
  competition,
  competitor,
  createDatabase,
  judge,
  route,
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
import { LocalDiskStorage } from '../lib/storage'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authenticateJudge,
  authHeaders,
  createJudgeFixture,
  judgeAuthHeaders,
  registerLoggedInOrganizer,
  type JudgeFixture,
} from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>
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
  fakeNow = new Date('2026-09-19T10:00:00.000Z')
  storageRoot = await mkdtemp(path.join(tmpdir(), 'climbcontest-gdpr-'))
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    now: () => fakeNow,
    storage: new LocalDiskStorage(storageRoot),
    videoMaxBytes: 1024 * 1024,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "organization", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "asset", "asset_upload", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
  await rm(storageRoot, { recursive: true, force: true })
})

const base = (f: JudgeFixture) => `/api/v1/competitions/${f.competition.id}`
const text = (value: string) => [...value].map((c) => c.charCodeAt(0))

/** Un compétiteur bien identifié, un passage corrigé avec un motif libre, un changement de statut motivé, une vidéo. */
async function populated() {
  const f = await createJudgeFixture(app, mailer)
  await app.request(`${base(f)}/competitors/${f.competitor.id}`, {
    method: 'PATCH',
    headers: authHeaders(f.organizerToken),
    body: JSON.stringify({
      birthYear: 2011,
      clubName: 'Club Alpin de Grenoble',
      licenseNumber: 'LIC-SECRET-42',
    }),
  })

  // Un passage saisi par le juge, puis corrigé par l'organisateur avec un motif libre.
  const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
  const detail = (await (
    await app.request(`/api/v1/judge/routes/${f.route.id}`, { headers: judgeAuthHeaders(judgeJwt) })
  ).json()) as { round: { id: string } }
  await app.request('/api/v1/judge/ascents/batch', {
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
          holdNumber: 20,
          modifier: 'none',
          isTop: false,
          status: 'valid',
          climbTimeMs: null,
          recordedAt: fakeNow.toISOString(),
          deviceId: 'device-gdpr',
        },
      ],
    }),
  })
  const rows = (await (
    await app.request(`${base(f)}/ascents?roundId=${detail.round.id}&routeId=${f.route.id}`, {
      headers: authHeaders(f.organizerToken),
    })
  ).json()) as { ascent: { id: string } | null }[]
  await app.request(`${base(f)}/ascents/${rows[0]!.ascent!.id}`, {
    method: 'PATCH',
    headers: authHeaders(f.organizerToken),
    body: JSON.stringify({
      holdNumber: 22,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      reason: 'Léa Martin s’est blessée au genou',
    }),
  })
  await app.request(`${base(f)}/competitors/${f.competitor.id}/status`, {
    method: 'PATCH',
    headers: authHeaders(f.organizerToken),
    body: JSON.stringify({ status: 'withdrawn', reason: 'Léa Martin a abandonné : entorse' }),
  })

  // Une vidéo téléversée.
  const mp4 = new Uint8Array(400)
  mp4.set([0, 0, 0, 0x18, ...text('ftypisom')])
  const up = await app.request(`${base(f)}/routes/${f.route.id}/video/uploads`, {
    method: 'POST',
    headers: authHeaders(f.organizerToken),
    body: JSON.stringify({ sizeBytes: mp4.byteLength, mimeType: 'video/mp4' }),
  })
  const { uploadId } = (await up.json()) as { uploadId: string }
  await app.request(`${base(f)}/routes/${f.route.id}/video/uploads/${uploadId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${f.organizerToken}`, 'Upload-Offset': '0' },
    body: mp4,
  })
  const done = await app.request(
    `${base(f)}/routes/${f.route.id}/video/uploads/${uploadId}/complete`,
    {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
    },
  )
  const { assetId } = (await done.json()) as { assetId: string }
  return { f, assetId }
}

function purge(f: JudgeFixture, confirmName: string, token = f.organizerToken) {
  return app.request(`${base(f)}/personal-data`, {
    method: 'DELETE',
    headers: authHeaders(token),
    body: JSON.stringify({ confirmName }),
  })
}

/** Un collègue de la même organisation, rôle « organizer » (pas propriétaire). */
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

describe('GET /competitions/:id/gdpr-export', () => {
  it('donne à l’organisateur propriétaire tout ce qui identifie une personne, et la durée de conservation', async () => {
    const { f } = await populated()

    const response = await app.request(`${base(f)}/gdpr-export`, {
      headers: authHeaders(f.organizerToken),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="donnees-personnelles-.+\.json"$/,
    )
    const body = (await response.json()) as {
      kind: string
      retention: { archiveAfterYears: number; purgeAfterYears: number; status: string }
      personalData: {
        competitors: Record<string, unknown>[]
        judges: { displayName: string }[]
        videos: { routeNumber: number; mimeType: string }[]
      }
      notes: string[]
    }
    expect(body.kind).toBe('export-donnees-personnelles')
    expect(body.retention).toEqual({ archiveAfterYears: 2, purgeAfterYears: 5, status: 'ok' })
    expect(body.personalData.competitors).toEqual([
      {
        bib: 1,
        firstName: 'Léa',
        lastName: 'Martin',
        birthYear: 2011,
        clubName: 'Club Alpin de Grenoble',
        licenseNumber: 'LIC-SECRET-42',
        status: 'withdrawn',
        categoryLabel: f.category.label,
      },
    ])
    expect(body.personalData.judges).toEqual([{ displayName: 'Juge Test' }])
    expect(body.personalData.videos).toEqual([
      expect.objectContaining({ routeNumber: 1, mimeType: 'video/mp4' }),
    ])
    expect(body.notes.join(' ')).toContain('vidéos')
  })

  it('n’expose ni jeton, ni PIN, ni hachage', async () => {
    const { f } = await populated()
    const text = await (
      await app.request(`${base(f)}/gdpr-export`, { headers: authHeaders(f.organizerToken) })
    ).text()
    expect(text).not.toContain(f.judge.accessToken)
    expect(text).not.toMatch(/accessToken|pinHash|passwordHash/i)
  })

  it('signale une compétition qui a dépassé la durée de conservation', async () => {
    const { f } = await populated()
    await handle.db
      .update(competition)
      .set({ endsOn: '2018-05-01' })
      .where(eq(competition.id, f.competition.id))
    const body = (await (
      await app.request(`${base(f)}/gdpr-export`, { headers: authHeaders(f.organizerToken) })
    ).json()) as {
      retention: { status: string }
    }
    expect(body.retention.status).toBe('purge_due')
  })

  it('est réservé au propriétaire : un collègue de l’organisation reçoit 403', async () => {
    const { f } = await populated()
    const colleague = await colleagueToken(f)
    const response = await app.request(`${base(f)}/gdpr-export`, {
      headers: authHeaders(colleague),
    })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { detail: string }).detail).toContain('propriétaire')
  })
})

describe('DELETE /competitions/:id/personal-data', () => {
  it('refuse sans le nom exact de la compétition, et ne supprime rien', async () => {
    const { f } = await populated()

    for (const wrong of [
      '',
      'coupe',
      String(f.competition['name']).toLowerCase(),
      `${String(f.competition['name'])} `,
    ]) {
      const response = await purge(f, wrong)
      expect(response.status, wrong).toBe(400)
      expect(((await response.json()) as { title: string }).title).toBe('Confirmation incorrecte')
    }
    const [c] = await handle.db
      .select()
      .from(competitor)
      .where(eq(competitor.competitionId, f.competition.id))
    expect(c?.lastName).toBe('Martin')
    const [comp] = await handle.db
      .select()
      .from(competition)
      .where(eq(competition.id, f.competition.id))
    expect(comp?.purgedAt).toBeNull()
  })

  it('est réservée au propriétaire : un collègue reçoit 403 et rien ne change', async () => {
    const { f } = await populated()
    const colleague = await colleagueToken(f)

    const response = await purge(f, String(f.competition['name']), colleague)

    expect(response.status).toBe(403)
    const [c] = await handle.db
      .select()
      .from(competitor)
      .where(eq(competitor.competitionId, f.competition.id))
    expect(c?.lastName).toBe('Martin')
  })

  it('anonymise les compétiteurs mais garde le dossard, le statut et les résultats', async () => {
    const { f } = await populated()

    const response = await purge(f, String(f.competition['name']))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      anonymizedCompetitors: 1,
      revokedJudges: 1,
      deletedVideos: 1,
    })
    const [c] = await handle.db
      .select()
      .from(competitor)
      .where(eq(competitor.competitionId, f.competition.id))
    expect(c).toMatchObject({
      firstName: 'Supprimé',
      lastName: '(données supprimées)',
      birthYear: null,
      clubName: null,
      licenseNumber: null,
      bib: 1,
      status: 'withdrawn',
    })
    // Les résultats restent, sans personne derrière.
    const ascents = await handle.db
      .select()
      .from(ascent)
      .where(eq(ascent.competitionId, f.competition.id))
    expect(ascents.length).toBeGreaterThan(0)
    expect(ascents.some((a) => a.holdNumber === 22)).toBe(true)
  })

  it('révoque les juges, efface leur nom et rend leur accès inutilisable', async () => {
    const { f } = await populated()
    await purge(f, String(f.competition['name']))

    const [j] = await handle.db
      .select()
      .from(judge)
      .where(eq(judge.competitionId, f.competition.id))
    expect(j).toMatchObject({
      displayName: 'Juge supprimé',
      pinHash: null,
      pinPlain: null,
      accessTokenPlain: null,
    })
    expect(j?.revokedAt).not.toBeNull()
    const auth = await app.request('/api/v1/judge/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: f.judge.accessToken }),
    })
    expect(auth.status).not.toBe(200)
  })

  it('supprime la vidéo, dans la base ET sur le disque', async () => {
    const { f, assetId } = await populated()
    const file = path.join(storageRoot, `competitions/${f.competition.id}/videos/${assetId}`)
    expect(existsSync(file)).toBe(true)

    await purge(f, String(f.competition['name']))

    expect(existsSync(file)).toBe(false)
    const [a] = await handle.db.select().from(asset).where(eq(asset.id, assetId))
    expect(a?.deletedAt).not.toBeNull()
    const [r] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(r?.videoAssetId).toBeNull()
    expect(r?.videoUrl).toBeNull()
  })

  it('supprime la photo de voie et ses prises, dans la base ET sur le disque (ADR-066)', async () => {
    const f = await createJudgeFixture(app, mailer)
    const put = await app.request(`${base(f)}/routes/${f.route.id}/photo`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${f.organizerToken}` },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
    })
    expect(put.status).toBe(201)
    const { assetId } = (await put.json()) as { assetId: string }
    await app.request(`${base(f)}/routes/${f.route.id}/photo/holds`, {
      method: 'PUT',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ holds: [{ number: 1, x: 0.5, y: 0.5 }] }),
    })
    const file = path.join(storageRoot, `competitions/${f.competition.id}/photos/${assetId}`)
    expect(existsSync(file)).toBe(true)

    // Le droit d'accès la liste, comme les vidéos.
    const exported = (await (
      await app.request(`${base(f)}/gdpr-export`, { headers: authHeaders(f.organizerToken) })
    ).json()) as { personalData: { photos: { routeNumber: number }[] } }
    expect(exported.personalData.photos).toEqual([expect.objectContaining({ routeNumber: 1 })])

    expect((await purge(f, String(f.competition['name']))).status).toBe(200)

    expect(existsSync(file)).toBe(false)
    const [a] = await handle.db.select().from(asset).where(eq(asset.id, assetId))
    expect(a?.deletedAt).not.toBeNull()
    const [r] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(r?.photoAssetId).toBeNull()
    expect(r?.photoHolds).toBeNull()
  })

  it('abandonne un envoi de vidéo en cours et supprime ses octets', async () => {
    const f = await createJudgeFixture(app, mailer)
    const up = await app.request(`${base(f)}/routes/${f.route.id}/video/uploads`, {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ sizeBytes: 500, mimeType: 'video/mp4' }),
    })
    const { uploadId } = (await up.json()) as { uploadId: string }
    await app.request(`${base(f)}/routes/${f.route.id}/video/uploads/${uploadId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${f.organizerToken}`, 'Upload-Offset': '0' },
      body: new Uint8Array(200),
    })
    const [session] = await handle.db.select().from(assetUpload).where(eq(assetUpload.id, uploadId))
    expect(existsSync(path.join(storageRoot, `${session!.storageKey}.part`))).toBe(true)

    await purge(f, String(f.competition['name']))

    expect(existsSync(path.join(storageRoot, `${session!.storageKey}.part`))).toBe(false)
    const [after] = await handle.db.select().from(assetUpload).where(eq(assetUpload.id, uploadId))
    expect(after?.status).toBe('aborted')
  })

  it('efface les motifs libres, où un nom ou une blessure a pu être écrit', async () => {
    const { f } = await populated()
    const before = await handle.db
      .select({ reason: ascentEvent.reason })
      .from(ascentEvent)
      .innerJoin(ascent, eq(ascent.id, ascentEvent.ascentId))
      .where(eq(ascent.competitionId, f.competition.id))
    expect(before.some((e) => e.reason?.includes('Léa'))).toBe(true)
    const logBefore = await handle.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.competitionId, f.competition.id))
    expect(logBefore.some((e) => e.reason?.includes('Léa'))).toBe(true)

    await purge(f, String(f.competition['name']))

    const after = await handle.db
      .select({ reason: ascentEvent.reason })
      .from(ascentEvent)
      .innerJoin(ascent, eq(ascent.id, ascentEvent.ascentId))
      .where(eq(ascent.competitionId, f.competition.id))
    expect(after.every((e) => e.reason === null)).toBe(true)
    const logAfter = await handle.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.competitionId, f.competition.id))
    expect(logAfter.every((e) => e.reason === null)).toBe(true)
  })

  it('conserve la ligne de la compétition comme trace, archivée, et invalide le lien public', async () => {
    const { f } = await populated()
    const oldSlug = String(f.competition['publicSlug'])

    await purge(f, String(f.competition['name']))

    const [comp] = await handle.db
      .select()
      .from(competition)
      .where(eq(competition.id, f.competition.id))
    expect(comp?.purgedAt?.toISOString()).toBe(fakeNow.toISOString())
    expect(comp?.status).toBe('archived')
    expect(comp?.publicSlug).not.toBe(oldSlug)
    expect((await app.request(`/api/v1/public/${oldSlug}`)).status).toBe(404)
  })

  it('ne se refait pas : une deuxième purge répond 409', async () => {
    const { f } = await populated()
    expect((await purge(f, String(f.competition['name']))).status).toBe(200)

    const second = await purge(f, String(f.competition['name']))

    expect(second.status).toBe(409)
    expect(((await second.json()) as { title: string }).title).toBe('Déjà purgée')
  })

  it('l’export reste possible après la purge et ne montre plus aucune personne', async () => {
    const { f } = await populated()
    await purge(f, String(f.competition['name']))

    const text = await (
      await app.request(`${base(f)}/gdpr-export`, { headers: authHeaders(f.organizerToken) })
    ).text()

    expect(text).not.toContain('Martin')
    expect(text).not.toContain('LIC-SECRET-42')
    expect(text).toContain('(données supprimées)')
  })

  it('ne touche pas aux autres compétitions de la même organisation', async () => {
    const { f } = await populated()
    const other = (await (
      await app.request('/api/v1/competitions', {
        method: 'POST',
        headers: authHeaders(f.organizerToken),
        body: JSON.stringify({
          name: 'Autre compétition',
          venue: 'Salle',
          startsOn: '2099-01-01',
          endsOn: '2099-01-01',
          format: 'contest',
          scoringEngineId: 'ffme-difficulty-2026',
          scoringConfig: { routesCounted: 1 },
        }),
      })
    ).json()) as { id: string }
    const category = (await (
      await app.request(`/api/v1/competitions/${other.id}/categories`, {
        method: 'POST',
        headers: authHeaders(f.organizerToken),
        body: JSON.stringify({ label: 'U14', sex: 'X' }),
      })
    ).json()) as { id: string }
    await app.request(`/api/v1/competitions/${other.id}/competitors`, {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({
        categoryId: category.id,
        bib: 5,
        firstName: 'Zoé',
        lastName: 'Petit',
      }),
    })

    await purge(f, String(f.competition['name']))

    const [untouched] = await handle.db
      .select()
      .from(competitor)
      .where(eq(competitor.competitionId, other.id))
    expect(untouched).toMatchObject({ firstName: 'Zoé', lastName: 'Petit' })
    const [comp] = await handle.db.select().from(competition).where(eq(competition.id, other.id))
    expect(comp?.purgedAt).toBeNull()
  })

  it('refuse à une autre organisation : 404, rien ne change', async () => {
    const { f } = await populated()
    const other = await registerLoggedInOrganizer(app, mailer)
    const response = await purge(f, String(f.competition['name']), other.accessToken)
    expect(response.status).toBe(404)
    const [c] = await handle.db
      .select()
      .from(competitor)
      .where(eq(competitor.competitionId, f.competition.id))
    expect(c?.lastName).toBe('Martin')
  })
})
