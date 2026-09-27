import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ROUTE_PHOTO_MAX_BYTES } from '@climbcontest/contracts'
import {
  applyPendingMigrations,
  asset,
  createDatabase,
  route,
  type DatabaseHandle,
} from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq, sql } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
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
let storage: LocalDiskStorage

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

// Une vraie photo JPEG (portrait 480×720) : `pdf-lib` doit pouvoir l'embarquer.
const WALL_JPEG = new Uint8Array(readFileSync(path.join(__dirname, '../test-utils/wall.jpg')))

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
  storageRoot = await mkdtemp(path.join(tmpdir(), 'climbcontest-photo-'))
  storage = new LocalDiskStorage(storageRoot)
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    storage,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "organization", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "asset", "asset_upload", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
  await rm(storageRoot, { recursive: true, force: true })
})

const photoUrl = (f: JudgeFixture, suffix = '') =>
  `/api/v1/competitions/${f.competition.id}/routes/${f.route.id}/photo${suffix}`

function putPhoto(
  f: JudgeFixture,
  body: Uint8Array,
  token = f.organizerToken,
  contentType = 'image/jpeg',
) {
  return app.request(photoUrl(f), {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
    body,
  })
}

function putHolds(f: JudgeFixture, holds: unknown, token = f.organizerToken) {
  return app.request(photoUrl(f, '/holds'), {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ holds }),
  })
}

const HOLDS = [
  { number: 1, x: 0.5, y: 0.9 },
  { number: 2, x: 0.45, y: 0.6 },
  { number: 3, x: 0.55, y: 0.3 },
]

/** Compétition avec photo ET prises placées. */
async function withPhoto(overrides?: Parameters<typeof createJudgeFixture>[2]) {
  const f = await createJudgeFixture(app, mailer, overrides)
  const put = await putPhoto(f, WALL_JPEG)
  expect(put.status).toBe(201)
  const { assetId } = (await put.json()) as { assetId: string }
  expect((await putHolds(f, HOLDS)).status).toBe(200)
  return { f, assetId }
}

async function recordAscent(f: JudgeFixture) {
  const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
  const detail = (await (
    await app.request(`/api/v1/judge/routes/${f.route.id}`, { headers: judgeAuthHeaders(judgeJwt) })
  ).json()) as { round: { id: string } }
  const response = await app.request('/api/v1/judge/ascents', {
    method: 'POST',
    headers: judgeAuthHeaders(judgeJwt),
    body: JSON.stringify({
      id: crypto.randomUUID(),
      roundId: detail.round.id,
      routeId: f.route.id,
      competitorId: f.competitor.id,
      holdNumber: 2,
      modifier: 'none',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
      recordedAt: new Date().toISOString(),
      deviceId: 'device-photo',
    }),
  })
  expect(response.status).toBe(201)
  return judgeJwt
}

const storedFile = (f: JudgeFixture, assetId: string) =>
  path.join(storageRoot, `competitions/${f.competition.id}/photos/${assetId}`)

describe('PUT /routes/:rid/photo', () => {
  it('enregistre un JPEG et le stocke sous une clé construite par le serveur', async () => {
    const f = await createJudgeFixture(app, mailer)
    const response = await putPhoto(f, WALL_JPEG)
    expect(response.status).toBe(201)
    const body = (await response.json()) as { assetId: string; holds: unknown[] }
    expect(body.holds).toEqual([])

    expect(existsSync(storedFile(f, body.assetId))).toBe(true)
    const [row] = await handle.db.select().from(asset).where(eq(asset.id, body.assetId))
    expect(row).toMatchObject({
      kind: 'route_photo',
      mimeType: 'image/jpeg',
      sizeBytes: WALL_JPEG.byteLength,
    })
    const [routeRow] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(routeRow?.photoAssetId).toBe(body.assetId)
  })

  it('reconnaît un JPEG à ses octets, quel que soit le type déclaré', async () => {
    const f = await createJudgeFixture(app, mailer)
    const response = await putPhoto(f, WALL_JPEG, f.organizerToken, 'text/plain')
    expect(response.status).toBe(201)
  })

  it('refuse un PNG même déclaré image/jpeg', async () => {
    const f = await createJudgeFixture(app, mailer)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const response = await putPhoto(f, png, f.organizerToken, 'image/jpeg')
    expect(response.status).toBe(400)
    const [routeRow] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(routeRow?.photoAssetId).toBeNull()
  })

  it('refuse un corps vide', async () => {
    const f = await createJudgeFixture(app, mailer)
    expect((await putPhoto(f, new Uint8Array(0))).status).toBe(400)
  })

  it('refuse une photo au-delà de la limite (413) sans rien stocker', async () => {
    const f = await createJudgeFixture(app, mailer)
    const tooBig = new Uint8Array(ROUTE_PHOTO_MAX_BYTES + 1)
    tooBig.set([0xff, 0xd8, 0xff])
    const response = await putPhoto(f, tooBig)
    expect(response.status).toBe(413)
    const rows = await handle.db.select().from(asset)
    expect(rows).toHaveLength(0)
  })

  it('remplacer la photo supprime l’ancien fichier et efface les prises', async () => {
    const { f, assetId: oldAssetId } = await withPhoto()
    expect(existsSync(storedFile(f, oldAssetId))).toBe(true)

    const response = await putPhoto(f, WALL_JPEG)
    expect(response.status).toBe(201)
    const { assetId: newAssetId } = (await response.json()) as { assetId: string }
    expect(newAssetId).not.toBe(oldAssetId)

    expect(existsSync(storedFile(f, oldAssetId))).toBe(false)
    expect(existsSync(storedFile(f, newAssetId))).toBe(true)
    const [oldRow] = await handle.db.select().from(asset).where(eq(asset.id, oldAssetId))
    expect(oldRow?.deletedAt).not.toBeNull()
    const [routeRow] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(routeRow?.photoAssetId).toBe(newAssetId)
    expect(routeRow?.photoHolds).toBeNull()
  })

  it('exige un organisateur connecté', async () => {
    const f = await createJudgeFixture(app, mailer)
    const response = await app.request(photoUrl(f), { method: 'PUT', body: WALL_JPEG })
    expect(response.status).toBe(401)
  })

  it('une autre organisation reçoit 404, jamais 403, sur chaque opération', async () => {
    const { f } = await withPhoto()
    const other = await registerLoggedInOrganizer(app, mailer)
    const token = other.accessToken
    expect((await putPhoto(f, WALL_JPEG, token)).status).toBe(404)
    expect((await putHolds(f, HOLDS, token)).status).toBe(404)
    expect((await app.request(photoUrl(f), { headers: authHeaders(token) })).status).toBe(404)
    expect(
      (await app.request(photoUrl(f), { method: 'DELETE', headers: authHeaders(token) })).status,
    ).toBe(404)
  })

  it('refuse une voie qui n’existe pas', async () => {
    const f = await createJudgeFixture(app, mailer)
    const response = await app.request(
      `/api/v1/competitions/${f.competition.id}/routes/${crypto.randomUUID()}/photo`,
      { method: 'PUT', headers: { authorization: `Bearer ${f.organizerToken}` }, body: WALL_JPEG },
    )
    expect(response.status).toBe(404)
  })
})

describe('PUT /routes/:rid/photo/holds', () => {
  it('enregistre les prises triées par numéro', async () => {
    const f = await createJudgeFixture(app, mailer)
    await putPhoto(f, WALL_JPEG)
    const response = await putHolds(f, [...HOLDS].reverse())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { holds: { number: number }[] }
    expect(body.holds.map((hold) => hold.number)).toEqual([1, 2, 3])
    const [routeRow] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(routeRow?.photoHolds).toEqual(HOLDS)
  })

  it('accepte une annotation partielle et une liste vide', async () => {
    const f = await createJudgeFixture(app, mailer, { holdCount: 40 })
    await putPhoto(f, WALL_JPEG)
    expect((await putHolds(f, [HOLDS[0]])).status).toBe(200)
    expect((await putHolds(f, [])).status).toBe(200)
  })

  it('refuse une prise dont le numéro dépasse le nombre de prises de la voie', async () => {
    const f = await createJudgeFixture(app, mailer, { holdCount: 5 })
    await putPhoto(f, WALL_JPEG)
    expect((await putHolds(f, [{ number: 5, x: 0.5, y: 0.5 }])).status).toBe(200)
    const response = await putHolds(f, [{ number: 6, x: 0.5, y: 0.5 }])
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('nombre de prises')
  })

  it.each([
    ['numéros en double', [HOLDS[0], HOLDS[0]]],
    ['coordonnée hors du cadre', [{ number: 1, x: 1.2, y: 0.5 }]],
    ['numéro nul', [{ number: 0, x: 0.5, y: 0.5 }]],
  ])('refuse %s', async (_label, holds) => {
    const f = await createJudgeFixture(app, mailer)
    await putPhoto(f, WALL_JPEG)
    expect((await putHolds(f, holds)).status).toBe(400)
  })

  it('refuse de placer des prises sur une voie sans photo', async () => {
    const f = await createJudgeFixture(app, mailer)
    const response = await putHolds(f, HOLDS)
    expect(response.status).toBe(409)
  })
})

describe('verrou une fois qu’un passage existe (ADR-066)', () => {
  it('refuse de remplacer la photo, de changer les prises ou de supprimer la photo', async () => {
    const { f, assetId } = await withPhoto()
    await recordAscent(f)

    expect((await putPhoto(f, WALL_JPEG)).status).toBe(409)
    expect((await putHolds(f, [HOLDS[0]])).status).toBe(409)
    const del = await app.request(photoUrl(f), {
      method: 'DELETE',
      headers: authHeaders(f.organizerToken),
    })
    expect(del.status).toBe(409)

    // Rien n'a bougé : même photo, même fichier, mêmes prises.
    expect(existsSync(storedFile(f, assetId))).toBe(true)
    const [routeRow] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(routeRow?.photoAssetId).toBe(assetId)
    expect(routeRow?.photoHolds).toEqual(HOLDS)
  })

  it('la photo reste lisible par l’organisateur', async () => {
    const { f } = await withPhoto()
    await recordAscent(f)
    const response = await app.request(photoUrl(f), { headers: authHeaders(f.organizerToken) })
    expect(response.status).toBe(200)
  })
})

describe('GET / et DELETE / (organisateur)', () => {
  it('relit exactement les octets envoyés, avec un type et des en-têtes sûrs', async () => {
    const { f, assetId } = await withPhoto()
    const response = await app.request(photoUrl(f), { headers: authHeaders(f.organizerToken) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('etag')).toBe(`"${assetId}"`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WALL_JPEG)
  })

  it('404 sans photo', async () => {
    const f = await createJudgeFixture(app, mailer)
    const response = await app.request(photoUrl(f), { headers: authHeaders(f.organizerToken) })
    expect(response.status).toBe(404)
  })

  it('supprime la photo, ses prises et son fichier', async () => {
    const { f, assetId } = await withPhoto()
    const response = await app.request(photoUrl(f), {
      method: 'DELETE',
      headers: authHeaders(f.organizerToken),
    })
    expect(response.status).toBe(204)
    expect(existsSync(storedFile(f, assetId))).toBe(false)
    const [routeRow] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(routeRow?.photoAssetId).toBeNull()
    expect(routeRow?.photoHolds).toBeNull()
    // Supprimer une seconde fois est sans effet.
    const again = await app.request(photoUrl(f), {
      method: 'DELETE',
      headers: authHeaders(f.organizerToken),
    })
    expect(again.status).toBe(204)
  })
})

describe('PATCH /routes/:rid — nombre de prises et prises placées', () => {
  const patchHoldCount = (f: JudgeFixture, holdCount: number) =>
    app.request(`/api/v1/competitions/${f.competition.id}/routes/${f.route.id}`, {
      method: 'PATCH',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ holdCount }),
    })

  it('refuse de descendre sous la plus haute prise placée', async () => {
    const { f } = await withPhoto({ holdCount: 10 })
    const response = await patchHoldCount(f, 2)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('prise 3')
    const [routeRow] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(routeRow?.holdCount).toBe(10)
  })

  it('accepte de descendre jusqu’à la plus haute prise placée, ou de monter', async () => {
    const { f } = await withPhoto({ holdCount: 10 })
    expect((await patchHoldCount(f, 3)).status).toBe(200)
    expect((await patchHoldCount(f, 50)).status).toBe(200)
  })
})

describe('juge : photo dans l’amorçage et téléchargement', () => {
  it('l’amorçage donne l’identifiant et les prises, pas les octets', async () => {
    const { f, assetId } = await withPhoto()
    const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
    const response = await app.request('/api/v1/judge/bootstrap', {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      routes: { route: { photo: { assetId: string; holds: unknown[] } | null } }[]
    }
    expect(body.routes[0]?.route.photo).toEqual({ assetId, holds: HOLDS })
  })

  it('l’amorçage donne photo = null pour une voie sans photo', async () => {
    const f = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
    const body = (await (
      await app.request('/api/v1/judge/bootstrap', { headers: judgeAuthHeaders(judgeJwt) })
    ).json()) as { routes: { route: { photo: unknown } }[] }
    expect(body.routes[0]?.route.photo).toBeNull()
  })

  it('le détail d’une voie porte aussi la photo', async () => {
    const { f, assetId } = await withPhoto()
    const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
    const body = (await (
      await app.request(`/api/v1/judge/routes/${f.route.id}`, {
        headers: judgeAuthHeaders(judgeJwt),
      })
    ).json()) as { route: { photo: { assetId: string } | null } }
    expect(body.route.photo?.assetId).toBe(assetId)
  })

  it('le juge affecté télécharge les octets de la photo', async () => {
    const { f } = await withPhoto()
    const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
    const response = await app.request(`/api/v1/judge/routes/${f.route.id}/photo`, {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WALL_JPEG)
  })

  it('404 pour une voie sans photo', async () => {
    const f = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)
    const response = await app.request(`/api/v1/judge/routes/${f.route.id}/photo`, {
      headers: judgeAuthHeaders(judgeJwt),
    })
    expect(response.status).toBe(404)
  })

  it('un juge d’une autre compétition, ou non affecté à la voie, reçoit 404', async () => {
    const { f } = await withPhoto()
    const other = await createJudgeFixture(app, mailer)
    const otherJwt = await authenticateJudge(app, other.judge.accessToken, other.judge.pin)
    const response = await app.request(`/api/v1/judge/routes/${f.route.id}/photo`, {
      headers: judgeAuthHeaders(otherJwt),
    })
    expect(response.status).toBe(404)
  })

  it('exige un juge authentifié', async () => {
    const { f } = await withPhoto()
    const response = await app.request(`/api/v1/judge/routes/${f.route.id}/photo`)
    expect(response.status).toBe(401)
  })
})

describe('GET /route-sheets.pdf', () => {
  const sheetsUrl = (f: JudgeFixture, query = '') =>
    `/api/v1/competitions/${f.competition.id}/route-sheets.pdf${query}`

  it('produit une page A4 par voie qui a une photo', async () => {
    const { f } = await withPhoto()
    const response = await app.request(sheetsUrl(f), { headers: authHeaders(f.organizerToken) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="fiches-voies-.+\.pdf"$/,
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    const page = pdf.getPage(0)
    expect(Math.round(page.getWidth())).toBe(595)
    expect(Math.round(page.getHeight())).toBe(842)
  })

  it('accepte une voie sans prise annotée', async () => {
    const f = await createJudgeFixture(app, mailer)
    await putPhoto(f, WALL_JPEG)
    const response = await app.request(sheetsUrl(f), { headers: authHeaders(f.organizerToken) })
    expect(response.status).toBe(200)
  })

  it('une seule voie avec ?routeId=', async () => {
    const { f } = await withPhoto()
    const response = await app.request(sheetsUrl(f, `?routeId=${f.route.id}`), {
      headers: authHeaders(f.organizerToken),
    })
    expect(response.status).toBe(200)
    const pdf = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))
    expect(pdf.getPageCount()).toBe(1)
  })

  it('409 explicite quand aucune voie n’a de photo', async () => {
    const f = await createJudgeFixture(app, mailer)
    const response = await app.request(sheetsUrl(f), { headers: authHeaders(f.organizerToken) })
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('photo')
  })

  it('400 pour un routeId mal formé', async () => {
    const { f } = await withPhoto()
    const response = await app.request(sheetsUrl(f, '?routeId=pas-un-uuid'), {
      headers: authHeaders(f.organizerToken),
    })
    expect(response.status).toBe(400)
  })

  it('409 quand le fichier de la photo a disparu du stockage', async () => {
    const { f, assetId } = await withPhoto()
    await rm(storedFile(f, assetId))
    const response = await app.request(sheetsUrl(f), { headers: authHeaders(f.organizerToken) })
    expect(response.status).toBe(409)
  })

  it('n’imprime pas les fiches d’une autre compétition (404 pour une autre organisation)', async () => {
    const { f } = await withPhoto()
    const other = await registerLoggedInOrganizer(app, mailer)
    const response = await app.request(sheetsUrl(f), {
      headers: authHeaders(other.accessToken),
    })
    expect(response.status).toBe(404)
  })
})
