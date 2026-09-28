import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  ORGANIZATION_PHOTO_MAX_BYTES,
  type OrganizationPhoto,
  type PublicCompetitionMeta,
} from '@climbcontest/contracts'
import { applyPendingMigrations, createDatabase, type DatabaseHandle } from '@climbcontest/db'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app'
import type { Env } from '../env'
import { createAccessTokenSigner, createJudgeTokenSigner } from '../lib/jwt'
import type { Logger } from '../lib/logger'
import { LocalDiskStorage } from '../lib/storage'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authHeaders,
  createTestCompetition,
  registerLoggedInOrganizer,
} from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>
let storageRoot: string

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
  AUTH_RATE_LIMIT_MAX: 10_000,
}

const WALL_JPEG = new Uint8Array(readFileSync(path.join(__dirname, '../test-utils/wall.jpg')))
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PHOTOS = '/api/v1/organization/photos'

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
  storageRoot = await mkdtemp(path.join(tmpdir(), 'climbcontest-organization-photo-'))
  app = createApp({
    env,
    db: handle.db,
    mailer,
    logger: { info: () => {} } as unknown as Logger,
    accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
    judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    storage: new LocalDiskStorage(storageRoot),
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "organization", "session", "organization_member_log", "organization_photo", "competition" cascade`,
  )
  await rm(storageRoot, { recursive: true, force: true })
})

const upload = (token: string, body: Uint8Array = WALL_JPEG) =>
  app.request(PHOTOS, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
    body,
  })

async function added(token: string): Promise<OrganizationPhoto> {
  const response = await upload(token)
  expect(response.status).toBe(201)
  return (await response.json()) as OrganizationPhoto
}

async function list(token: string): Promise<OrganizationPhoto[]> {
  const response = await app.request(PHOTOS, { headers: authHeaders(token) })
  expect(response.status).toBe(200)
  return (await response.json()) as OrganizationPhoto[]
}

const send = (method: string, url: string, token: string, body?: unknown) =>
  app.request(url, {
    method,
    headers: authHeaders(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function storedFiles(): Promise<string[]> {
  const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
}

/** Un membre `organizer` (pas owner) de la même organisation, connecté. */
async function addOrganizer(ownerToken: string): Promise<string> {
  const email = `${crypto.randomUUID()}@club-demo.test`
  const invited = await send('POST', '/api/v1/auth/invitations', ownerToken, {
    email,
    displayName: 'Camille',
    role: 'organizer',
  })
  expect(invited.status).toBe(201)
  const accepted = await app.request('/api/v1/auth/invitations/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: mailer.lastTokenFor(email), password: 'un-mot-de-passe-solide' }),
  })
  expect(accepted.status).toBe(201)
  return ((await accepted.json()) as { accessToken: string }).accessToken
}

describe('photos de l’organisation (ADR-090)', () => {
  it('l’owner ajoute une photo : elle est listée, lisible, rangée sous la clé de l’organisation', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const photo = await added(owner.accessToken)
    expect(photo).toEqual({ id: expect.any(String), altText: null })
    expect(await list(owner.accessToken)).toEqual([photo])

    const image = await app.request(`${PHOTOS}/${photo.id}`, {
      headers: authHeaders(owner.accessToken),
    })
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/jpeg')
    expect(image.headers.get('cache-control')).toBe('private, max-age=86400, immutable')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(WALL_JPEG)

    const rows = await handle.db.execute(
      sql`select storage_key, organization_id from organization_photo`,
    )
    const row = rows.rows[0] as { storage_key: string; organization_id: string }
    expect(row.storage_key).toBe(`organizations/${row.organization_id}/photos/${photo.id}`)
  })

  it('refuse un fichier vide, un autre format que JPEG et une photo de plus de 8 Mio', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    expect((await upload(owner.accessToken, new Uint8Array())).status).toBe(400)
    const png = await upload(owner.accessToken, PNG_HEAD)
    expect(png.status).toBe(400)
    expect(await png.json()).toMatchObject({ title: 'Format non accepté' })
    const tooBig = new Uint8Array(ORGANIZATION_PHOTO_MAX_BYTES + 1)
    tooBig.set([0xff, 0xd8, 0xff])
    expect((await upload(owner.accessToken, tooBig)).status).toBe(413)
    expect(await list(owner.accessToken)).toEqual([])
    expect(await storedFiles()).toEqual([])
  })

  it('six photos au plus ; la septième est refusée et son fichier n’est pas gardé', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    for (let i = 0; i < 6; i += 1) await added(owner.accessToken)
    const seventh = await upload(owner.accessToken)
    expect(seventh.status).toBe(409)
    expect(await seventh.json()).toMatchObject({ title: 'Six photos au plus' })
    expect(await list(owner.accessToken)).toHaveLength(6)
    expect(await storedFiles()).toHaveLength(6)
  })

  it('trois envois simultanés sur cinq photos n’en ajoutent qu’un', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    for (let i = 0; i < 5; i += 1) await added(owner.accessToken)
    const statuses = (await Promise.all([1, 2, 3].map(async () => upload(owner.accessToken)))).map(
      (response) => response.status,
    )
    expect(statuses.sort()).toEqual([201, 409, 409])
    expect(await list(owner.accessToken)).toHaveLength(6)
  })

  it('le texte alternatif se modifie et s’efface', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const photo = await added(owner.accessToken)
    const url = `${PHOTOS}/${photo.id}`
    const named = await send('PATCH', url, owner.accessToken, { altText: '  Le mur de bloc  ' })
    expect(await named.json()).toEqual({ id: photo.id, altText: 'Le mur de bloc' })
    const tooLong = await send('PATCH', url, owner.accessToken, { altText: 'a'.repeat(201) })
    expect(tooLong.status).toBe(400)
    const cleared = await send('PATCH', url, owner.accessToken, { altText: null })
    expect(await cleared.json()).toEqual({ id: photo.id, altText: null })
  })

  it('une nouvelle photo va à la fin ; l’ordre se change en entier et doit être complet', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const first = await added(owner.accessToken)
    const second = await added(owner.accessToken)
    const third = await added(owner.accessToken)
    expect((await list(owner.accessToken)).map((p) => p.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])

    const order = `${PHOTOS}/order`
    const reordered = await send('PUT', order, owner.accessToken, {
      photoIds: [third.id, first.id, second.id],
    })
    expect(reordered.status).toBe(200)
    const expected = [third.id, first.id, second.id]
    expect(((await reordered.json()) as OrganizationPhoto[]).map((p) => p.id)).toEqual(expected)
    expect((await list(owner.accessToken)).map((p) => p.id)).toEqual(expected)

    const incomplete = await send('PUT', order, owner.accessToken, {
      photoIds: [first.id, second.id],
    })
    expect(incomplete.status).toBe(409)
    const foreign = await send('PUT', order, owner.accessToken, {
      photoIds: [first.id, second.id, crypto.randomUUID()],
    })
    expect(foreign.status).toBe(409)
    const repeated = await send('PUT', order, owner.accessToken, {
      photoIds: [first.id, first.id, second.id],
    })
    expect(repeated.status).toBe(400)
    expect((await list(owner.accessToken)).map((p) => p.id)).toEqual(expected)
  })

  it('supprimer retire la photo de la fiche sans effacer le fichier ; « Annuler » la remet à sa place', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const first = await added(owner.accessToken)
    const second = await added(owner.accessToken)
    const third = await added(owner.accessToken)

    const deleted = await send('DELETE', `${PHOTOS}/${second.id}`, owner.accessToken)
    expect(deleted.status).toBe(204)
    expect((await list(owner.accessToken)).map((p) => p.id)).toEqual([first.id, third.id])
    expect(await storedFiles()).toHaveLength(3)
    const image = await app.request(`${PHOTOS}/${second.id}`, {
      headers: authHeaders(owner.accessToken),
    })
    expect(image.status).toBe(404)
    // Supprimer deux fois ne fait rien de plus.
    expect((await send('DELETE', `${PHOTOS}/${second.id}`, owner.accessToken)).status).toBe(204)

    const restored = await send('POST', `${PHOTOS}/${second.id}/restore`, owner.accessToken)
    expect(restored.status).toBe(200)
    expect((await list(owner.accessToken)).map((p) => p.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])
  })

  it('« Annuler » est refusé quand six photos sont déjà actives', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const removed = await added(owner.accessToken)
    await send('DELETE', `${PHOTOS}/${removed.id}`, owner.accessToken)
    for (let i = 0; i < 6; i += 1) await added(owner.accessToken)
    const restored = await send('POST', `${PHOTOS}/${removed.id}/restore`, owner.accessToken)
    expect(restored.status).toBe(409)
    expect(await list(owner.accessToken)).toHaveLength(6)
  })

  it('un organizer voit les photos mais ne les modifie pas', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const photo = await added(owner.accessToken)
    const organizer = await addOrganizer(owner.accessToken)

    expect(await list(organizer)).toEqual([photo])
    const image = await app.request(`${PHOTOS}/${photo.id}`, { headers: authHeaders(organizer) })
    expect(image.status).toBe(200)

    expect((await upload(organizer)).status).toBe(403)
    const url = `${PHOTOS}/${photo.id}`
    expect((await send('PATCH', url, organizer, { altText: 'x' })).status).toBe(403)
    expect((await send('PUT', `${PHOTOS}/order`, organizer, { photoIds: [photo.id] })).status).toBe(
      403,
    )
    expect((await send('DELETE', url, organizer)).status).toBe(403)
    expect((await send('POST', `${url}/restore`, organizer)).status).toBe(403)
    expect(await list(owner.accessToken)).toEqual([photo])
  })

  it('une autre organisation ne voit ni ne touche les photos (404)', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const photo = await added(owner.accessToken)
    const stranger = await registerLoggedInOrganizer(app, mailer)
    const url = `${PHOTOS}/${photo.id}`

    expect(await list(stranger.accessToken)).toEqual([])
    const image = await app.request(url, { headers: authHeaders(stranger.accessToken) })
    expect(image.status).toBe(404)
    expect((await send('PATCH', url, stranger.accessToken, { altText: 'x' })).status).toBe(404)
    expect((await send('DELETE', url, stranger.accessToken)).status).toBe(404)
    expect((await send('POST', `${url}/restore`, stranger.accessToken)).status).toBe(404)
    expect(await list(owner.accessToken)).toEqual([photo])
  })

  it('page publique : photos actives dans l’ordre, lisibles par la compétition de l’organisation seulement', async () => {
    const owner = await registerLoggedInOrganizer(app, mailer)
    const first = await added(owner.accessToken)
    const second = await added(owner.accessToken)
    const removed = await added(owner.accessToken)
    await send('PATCH', `${PHOTOS}/${second.id}`, owner.accessToken, { altText: 'Le mur' })
    await send('PUT', `${PHOTOS}/order`, owner.accessToken, {
      photoIds: [second.id, first.id, removed.id],
    })
    await send('DELETE', `${PHOTOS}/${removed.id}`, owner.accessToken)

    const competition = await createTestCompetition(app, owner.accessToken)
    const slug = String(competition['publicSlug'])
    const headers = { 'x-forwarded-for': '198.51.100.27' }
    const meta = (await (
      await app.request(`/api/v1/public/${slug}`, { headers })
    ).json()) as PublicCompetitionMeta
    expect(meta.organization.photos).toEqual([
      { id: second.id, altText: 'Le mur' },
      { id: first.id, altText: null },
    ])

    const image = await app.request(`/api/v1/public/${slug}/organization/photos/${first.id}`, {
      headers,
    })
    expect(image.status).toBe(200)
    expect(image.headers.get('cache-control')).toBe('public, max-age=86400, immutable')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(WALL_JPEG)

    const gone = await app.request(`/api/v1/public/${slug}/organization/photos/${removed.id}`, {
      headers,
    })
    expect(gone.status).toBe(404)

    // La photo d'une organisation ne se lit pas par la compétition d'une autre.
    const stranger = await registerLoggedInOrganizer(app, mailer)
    const otherCompetition = await createTestCompetition(app, stranger.accessToken)
    const crossed = await app.request(
      `/api/v1/public/${String(otherCompetition['publicSlug'])}/organization/photos/${first.id}`,
      { headers },
    )
    expect(crossed.status).toBe(404)
    const malformed = await app.request(`/api/v1/public/${slug}/organization/photos/pas-un-uuid`, {
      headers,
    })
    expect(malformed.status).toBe(400)
  })
})
