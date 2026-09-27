import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  applyPendingMigrations,
  asset,
  assetUpload,
  createDatabase,
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
import { UPLOAD_TTL_MS, cleanupExpiredUploads } from '../lib/video/upload'
import { FakeMailer } from '../test-utils/fake-mailer'
import {
  authenticateJudge,
  authHeaders,
  createJudgeFixture,
  registerLoggedInOrganizer,
  type JudgeFixture,
} from '../test-utils/fixtures'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle
let mailer: FakeMailer
let app: ReturnType<typeof createApp>
let storageRoot: string
let storage: LocalDiskStorage
let fakeNow: Date

const MAX_BYTES = 1024 * 1024

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
  storageRoot = await mkdtemp(path.join(tmpdir(), 'climbcontest-video-'))
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
    videoMaxBytes: MAX_BYTES,
  })
})

afterEach(async () => {
  await handle.db.execute(
    sql`truncate table "user", "organization", "session", "competition", "round", "category", "competitor", "route", "route_category", "round_route", "asset", "asset_upload", "ascent", "ascent_event", "activity_log", "judge", "judge_route" cascade`,
  )
  await rm(storageRoot, { recursive: true, force: true })
})

const text = (value: string) => [...value].map((c) => c.charCodeAt(0))

/** Un « fichier » MP4 minimal : signature `ftyp isom` puis du remplissage reconnaissable. */
function mp4(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  // `slice` : un morceau de moins de 16 octets (simple remplissage) reste valable.
  bytes.set([0, 0, 0, 0x18, ...text('ftypisom'), 0, 0, 0, 0].slice(0, size))
  for (let i = 16; i < size; i += 1) bytes[i] = i % 251
  return bytes
}

function webm(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, ...text('webm')])
  return bytes
}

const uploadsUrl = (f: JudgeFixture, suffix = '') =>
  `/api/v1/competitions/${f.competition.id}/routes/${f.route.id}/video/uploads${suffix}`

function post(f: JudgeFixture, url: string, body?: unknown, token = f.organizerToken) {
  return app.request(url, {
    method: 'POST',
    headers: authHeaders(token),
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}

function patchChunk(
  f: JudgeFixture,
  uploadId: string,
  offset: number | string | null,
  body: Uint8Array,
  token = f.organizerToken,
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/octet-stream',
  }
  if (offset !== null) headers['Upload-Offset'] = String(offset)
  return app.request(uploadsUrl(f, `/${uploadId}`), { method: 'PATCH', headers, body })
}

async function start(f: JudgeFixture, sizeBytes: number, mimeType = 'video/mp4') {
  const response = await post(f, uploadsUrl(f), { sizeBytes, mimeType })
  expect(response.status).toBe(201)
  return (await response.json()) as {
    uploadId: string
    chunkSize: number
    maxBytes: number
    receivedBytes: number
  }
}

/** Envoie `file` en morceaux de `chunk` octets, puis termine. */
async function uploadAll(f: JudgeFixture, file: Uint8Array, mimeType = 'video/mp4', chunk = 1000) {
  const { uploadId } = await start(f, file.byteLength, mimeType)
  for (let offset = 0; offset < file.byteLength; offset += chunk) {
    const response = await patchChunk(f, uploadId, offset, file.subarray(offset, offset + chunk))
    expect(response.status).toBe(200)
  }
  const done = await post(f, uploadsUrl(f, `/${uploadId}/complete`))
  return { uploadId, done }
}

function publicSlugOf(f: JudgeFixture): string {
  return String(f.competition['publicSlug'])
}

const publicVideo = (f: JudgeFixture, headers: Record<string, string> = {}) =>
  app.request(`/api/v1/public/${publicSlugOf(f)}/routes/${f.route.id}/video`, { headers })

describe('envoi complet', () => {
  it('envoie par morceaux, termine, puis le public lit la vidéo sans authentification', async () => {
    const f = await createJudgeFixture(app, mailer)
    const file = mp4(2500)

    const { done } = await uploadAll(f, file)

    expect(done.status).toBe(201)
    const assetDto = (await done.json()) as { assetId: string; mimeType: string; sizeBytes: number }
    expect(assetDto).toMatchObject({ mimeType: 'video/mp4', sizeBytes: 2500 })

    const response = await publicVideo(f)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-length')).toBe('2500')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(file)
  })

  it('la liste publique des voies annonce la vidéo téléversée', async () => {
    const f = await createJudgeFixture(app, mailer)
    await uploadAll(f, mp4(1500))

    const routes = (await (
      await app.request(`/api/v1/public/${publicSlugOf(f)}/routes?category=${f.category.id}`)
    ).json()) as { id: string; hasUploadedVideo: boolean }[]

    expect(routes.find((r) => r.id === f.route.id)?.hasUploadedVideo).toBe(true)
  })

  it('sert une plage d’octets (206) pour que la vidéo soit déplaçable', async () => {
    const f = await createJudgeFixture(app, mailer)
    const file = mp4(3000)
    await uploadAll(f, file)

    const response = await publicVideo(f, { range: 'bytes=100-199' })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 100-199/3000')
    expect(response.headers.get('content-length')).toBe('100')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(file.subarray(100, 200))
  })

  it('répond 416 à une plage hors du fichier, avec la taille réelle', async () => {
    const f = await createJudgeFixture(app, mailer)
    await uploadAll(f, mp4(1000))

    const response = await publicVideo(f, { range: 'bytes=5000-' })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */1000')
  })

  it('un type déclaré mp4 mais un contenu webm : c’est le contenu qui fait foi', async () => {
    const f = await createJudgeFixture(app, mailer)

    const { done } = await uploadAll(f, webm(1200), 'video/mp4')

    expect(done.status).toBe(201)
    expect(((await done.json()) as { mimeType: string }).mimeType).toBe('video/webm')
    expect((await publicVideo(f)).headers.get('content-type')).toBe('video/webm')
  })
})

describe('reprise après une coupure', () => {
  it('dit où reprendre, et le morceau rejoué au mauvais octet est refusé avec l’offset attendu', async () => {
    const f = await createJudgeFixture(app, mailer)
    const file = mp4(3000)
    const { uploadId } = await start(f, file.byteLength)
    expect((await patchChunk(f, uploadId, 0, file.subarray(0, 1000))).status).toBe(200)

    // Reprise : le client demande où en est le serveur.
    const status = await app.request(uploadsUrl(f, `/${uploadId}`), {
      headers: authHeaders(f.organizerToken),
    })
    expect(status.headers.get('Upload-Offset')).toBe('1000')
    expect(((await status.json()) as { receivedBytes: number }).receivedBytes).toBe(1000)

    // Le client, ne sachant pas, rejoue le premier morceau.
    const replay = await patchChunk(f, uploadId, 0, file.subarray(0, 1000))
    expect(replay.status).toBe(409)
    expect(replay.headers.get('Upload-Offset')).toBe('1000')
    expect(((await replay.json()) as { expectedOffset: number }).expectedOffset).toBe(1000)

    // Il se recale et termine.
    expect((await patchChunk(f, uploadId, 1000, file.subarray(1000))).status).toBe(200)
    expect((await post(f, uploadsUrl(f, `/${uploadId}/complete`))).status).toBe(201)
    expect(new Uint8Array(await (await publicVideo(f)).arrayBuffer())).toEqual(file)
  })

  it('survit à un « redémarrage » : un nouvel adaptateur sur le même disque reprend', async () => {
    const f = await createJudgeFixture(app, mailer)
    const file = mp4(2000)
    const { uploadId } = await start(f, file.byteLength)
    await patchChunk(f, uploadId, 0, file.subarray(0, 700))

    app = createApp({
      env,
      db: handle.db,
      mailer,
      logger: { info: () => {} } as unknown as Logger,
      accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
      judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
      now: () => fakeNow,
      storage: new LocalDiskStorage(storageRoot),
      videoMaxBytes: MAX_BYTES,
    })

    const status = await app.request(uploadsUrl(f, `/${uploadId}`), {
      headers: authHeaders(f.organizerToken),
    })
    expect(((await status.json()) as { receivedBytes: number }).receivedBytes).toBe(700)
    expect((await patchChunk(f, uploadId, 700, file.subarray(700))).status).toBe(200)
    expect((await post(f, uploadsUrl(f, `/${uploadId}/complete`))).status).toBe(201)
  })
})

describe('refus', () => {
  it('une vidéo plus grosse que la limite, avec un message qui dit quoi faire', async () => {
    const f = await createJudgeFixture(app, mailer)

    const response = await post(f, uploadsUrl(f), {
      sizeBytes: MAX_BYTES + 1,
      mimeType: 'video/mp4',
    })

    expect(response.status).toBe(413)
    const body = (await response.json()) as { title: string; detail: string }
    expect(body.title).toBe('Vidéo trop volumineuse')
    expect(body.detail).toContain('la limite est de 1 Mo')
    expect(body.detail).toContain('YouTube ou Vimeo')
  })

  it.each([
    ['un type non vidéo', { sizeBytes: 100, mimeType: 'application/pdf' }],
    ['un type absent', { sizeBytes: 100 }],
    ['une taille nulle', { sizeBytes: 0, mimeType: 'video/mp4' }],
    ['une taille négative', { sizeBytes: -5, mimeType: 'video/mp4' }],
    ['une taille non entière', { sizeBytes: 1.5, mimeType: 'video/mp4' }],
  ])('refuse %s à la création', async (_label, body) => {
    const f = await createJudgeFixture(app, mailer)
    expect((await post(f, uploadsUrl(f), body)).status).toBe(400)
  })

  it('refuse plus d’octets que la taille annoncée, sans rien écrire', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 100)

    const response = await patchChunk(f, uploadId, 0, mp4(200))

    expect(response.status).toBe(400)
    expect(((await response.json()) as { title: string }).title).toBe('Trop d’octets')
    expect(
      await storage.uploadedBytes(
        `competitions/${f.competition.id}/videos/${(await handle.db.select().from(assetUpload))[0]!.storageKey.split('/').at(-1)}`,
      ),
    ).toBe(0)
  })

  it('refuse un morceau vide', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 100)
    expect((await patchChunk(f, uploadId, 0, new Uint8Array())).status).toBe(400)
  })

  it.each([
    ['absent', null],
    ['négatif', '-1'],
    ['décimal', '1.5'],
    ['texte', 'abc'],
  ])('refuse un Upload-Offset %s', async (_label, offset) => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 100)
    const response = await patchChunk(f, uploadId, offset, mp4(50))
    expect(response.status).toBe(400)
    expect(((await response.json()) as { title: string }).title).toBe('Décalage manquant')
  })

  it('refuse un morceau de plus de 16 Mo (413)', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 100)
    const response = await patchChunk(f, uploadId, 0, new Uint8Array(17 * 1024 * 1024))
    expect(response.status).toBe(413)
  })

  it('refuse de terminer un envoi incomplet, en disant où reprendre', async () => {
    const f = await createJudgeFixture(app, mailer)
    const file = mp4(1000)
    const { uploadId } = await start(f, file.byteLength)
    await patchChunk(f, uploadId, 0, file.subarray(0, 400))

    const response = await post(f, uploadsUrl(f, `/${uploadId}/complete`))

    expect(response.status).toBe(409)
    const body = (await response.json()) as { title: string; detail: string }
    expect(body.title).toBe('Envoi incomplet')
    expect(body.detail).toContain('Il manque 600 octets')
    expect(body.detail).toContain('octet 400')
  })

  it('refuse un fichier qui n’est pas une vidéo, même déclaré mp4 — et rien n’est publié', async () => {
    const f = await createJudgeFixture(app, mailer)
    const pdf = new Uint8Array(1000)
    pdf.set(text('%PDF-1.7 pas une video'))

    const { uploadId, done } = await uploadAll(f, pdf, 'video/mp4')

    expect(done.status).toBe(400)
    const body = (await done.json()) as { title: string; detail: string }
    expect(body.title).toBe('Format non accepté')
    expect(body.detail).toContain('MP4, MOV (QuickTime) et WebM')
    expect((await publicVideo(f)).status).toBe(404)
    expect(await handle.db.select().from(asset)).toHaveLength(0)
    const [session] = await handle.db.select().from(assetUpload).where(eq(assetUpload.id, uploadId))
    expect(session?.status).toBe('aborted')
    // Le fichier envoyé a été supprimé du disque.
    expect(existsSync(path.join(storageRoot, session!.storageKey + '.part'))).toBe(false)
  })

  it('refuse une image HEIC dans un conteneur qui ressemble à du MP4', async () => {
    const f = await createJudgeFixture(app, mailer)
    const heic = new Uint8Array(500)
    heic.set([0, 0, 0, 0x18, ...text('ftypheic')])
    const { done } = await uploadAll(f, heic)
    expect(done.status).toBe(400)
  })

  it('refuse de terminer deux fois, et de continuer un envoi terminé', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId, done } = await uploadAll(f, mp4(500))
    expect(done.status).toBe(201)

    expect((await post(f, uploadsUrl(f, `/${uploadId}/complete`))).status).toBe(409)
    expect((await patchChunk(f, uploadId, 0, mp4(10))).status).toBe(409)
  })
})

describe('remplacer, supprimer, abandonner', () => {
  it('un nouvel envoi terminé remplace le lien externe ET l’ancienne vidéo, dont le fichier disparaît', async () => {
    const f = await createJudgeFixture(app, mailer)
    await app.request(`/api/v1/competitions/${f.competition.id}/routes/${f.route.id}`, {
      method: 'PATCH',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ videoUrl: 'https://youtu.be/abc' }),
    })
    const first = (await (await uploadAll(f, mp4(600))).done.json()) as { assetId: string }
    const [afterFirst] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(afterFirst?.videoUrl).toBeNull()
    expect(afterFirst?.videoAssetId).toBe(first.assetId)
    const firstKey = `competitions/${f.competition.id}/videos/${first.assetId}`
    expect(existsSync(path.join(storageRoot, firstKey))).toBe(true)

    const second = (await (await uploadAll(f, mp4(700))).done.json()) as { assetId: string }

    const [afterSecond] = await handle.db.select().from(route).where(eq(route.id, f.route.id))
    expect(afterSecond?.videoAssetId).toBe(second.assetId)
    expect(existsSync(path.join(storageRoot, firstKey))).toBe(false)
    const [oldAsset] = await handle.db.select().from(asset).where(eq(asset.id, first.assetId))
    expect(oldAsset?.deletedAt).not.toBeNull()
    expect((await publicVideo(f)).headers.get('content-length')).toBe('700')
  })

  it('supprimer la vidéo la retire du public et du disque, sans erreur au second appel', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { assetId } = (await (await uploadAll(f, mp4(600))).done.json()) as { assetId: string }
    const url = `/api/v1/competitions/${f.competition.id}/routes/${f.route.id}/video`

    expect(
      (await app.request(url, { method: 'DELETE', headers: authHeaders(f.organizerToken) })).status,
    ).toBe(204)
    expect((await publicVideo(f)).status).toBe(404)
    expect(
      existsSync(path.join(storageRoot, `competitions/${f.competition.id}/videos/${assetId}`)),
    ).toBe(false)
    expect(
      (await app.request(url, { method: 'DELETE', headers: authHeaders(f.organizerToken) })).status,
    ).toBe(204)
  })

  it('abandonner un envoi supprime ce qui a été reçu', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 1000)
    await patchChunk(f, uploadId, 0, mp4(300))

    const aborted = await app.request(uploadsUrl(f, `/${uploadId}`), {
      method: 'DELETE',
      headers: authHeaders(f.organizerToken),
    })

    expect(aborted.status).toBe(204)
    expect((await patchChunk(f, uploadId, 300, mp4(10))).status).toBe(409)
    const [session] = await handle.db.select().from(assetUpload)
    expect(existsSync(path.join(storageRoot, session!.storageKey + '.part'))).toBe(false)
  })

  it('commencer un nouvel envoi abandonne le précédent de la même voie', async () => {
    const f = await createJudgeFixture(app, mailer)
    const first = await start(f, 1000)
    await patchChunk(f, first.uploadId, 0, mp4(300))

    await start(f, 500)

    const sessions = await handle.db.select().from(assetUpload)
    expect(sessions.filter((s) => s.status === 'uploading')).toHaveLength(1)
    expect(sessions.find((s) => s.id === first.uploadId)?.status).toBe('aborted')
    expect((await patchChunk(f, first.uploadId, 300, mp4(10))).status).toBe(409)
  })
})

describe('expiration', () => {
  it('un envoi expiré refuse de nouveaux morceaux', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 1000)
    fakeNow = new Date(fakeNow.getTime() + UPLOAD_TTL_MS + 1000)

    const response = await patchChunk(f, uploadId, 0, mp4(100))

    expect(response.status).toBe(409)
    expect(((await response.json()) as { title: string }).title).toBe('Envoi expiré')
  })

  it('la purge supprime les envois abandonnés et leurs octets, pas les récents ni les terminés', async () => {
    // Trois voies de trois compétitions : un seul envoi actif par voie (le
    // suivant abandonnerait le précédent), donc chacun sur la sienne.
    const stale = await createJudgeFixture(app, mailer)
    const finished = await createJudgeFixture(app, mailer)
    const recent = await createJudgeFixture(app, mailer)

    const staleUpload = await start(stale, 1000)
    await patchChunk(stale, staleUpload.uploadId, 0, mp4(300))
    await uploadAll(finished, mp4(400))
    const recentUpload = await start(recent, 1000)

    // Une seule ligne dépasse son délai : celle de `stale`.
    const [staleRow] = await handle.db
      .select()
      .from(assetUpload)
      .where(eq(assetUpload.id, staleUpload.uploadId))
    await handle.db
      .update(assetUpload)
      .set({ expiresAt: new Date(fakeNow.getTime() - 1) })
      .where(eq(assetUpload.id, staleUpload.uploadId))

    const purged = await cleanupExpiredUploads({
      db: handle.db,
      storage,
      maxBytes: MAX_BYTES,
      now: () => fakeNow,
    })

    expect(purged).toBe(1)
    const rows = await handle.db.select().from(assetUpload)
    expect(rows.find((r) => r.id === staleUpload.uploadId)?.status).toBe('aborted')
    expect(rows.find((r) => r.id === recentUpload.uploadId)?.status).toBe('uploading')
    expect(existsSync(path.join(storageRoot, staleRow!.storageKey + '.part'))).toBe(false)
    expect((await handle.db.select().from(asset)).filter((a) => a.deletedAt === null)).toHaveLength(
      1,
    )
  })
})

describe('contrôle d’accès', () => {
  it('exige un organisateur : sans jeton, ou avec un jeton juge, 401', async () => {
    const f = await createJudgeFixture(app, mailer)
    const judgeJwt = await authenticateJudge(app, f.judge.accessToken, f.judge.pin)

    expect(
      (
        await app.request(uploadsUrl(f), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401)
    expect(
      (await post(f, uploadsUrl(f), { sizeBytes: 100, mimeType: 'video/mp4' }, judgeJwt)).status,
    ).toBe(401)
  })

  it('une autre organisation reçoit 404 sur chaque opération, jamais 403', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 1000)
    const other = await registerLoggedInOrganizer(app, mailer)
    const tokenHeaders = authHeaders(other.accessToken)

    const responses = await Promise.all([
      post(f, uploadsUrl(f), { sizeBytes: 100, mimeType: 'video/mp4' }, other.accessToken),
      app.request(uploadsUrl(f, `/${uploadId}`), { headers: tokenHeaders }),
      patchChunk(f, uploadId, 0, mp4(10), other.accessToken),
      post(f, uploadsUrl(f, `/${uploadId}/complete`), undefined, other.accessToken),
      app.request(uploadsUrl(f, `/${uploadId}`), { method: 'DELETE', headers: tokenHeaders }),
      app.request(`/api/v1/competitions/${f.competition.id}/routes/${f.route.id}/video`, {
        method: 'DELETE',
        headers: tokenHeaders,
      }),
    ])

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404])
  })

  it('une voie d’une autre compétition de la même organisation est introuvable', async () => {
    const f = await createJudgeFixture(app, mailer)
    const g = await createJudgeFixture(app, mailer)
    const url = `/api/v1/competitions/${f.competition.id}/routes/${g.route.id}/video/uploads`

    const response = await app.request(url, {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ sizeBytes: 100, mimeType: 'video/mp4' }),
    })

    expect(response.status).toBe(404)
  })

  it('un envoi ne se termine pas depuis une autre voie', async () => {
    const f = await createJudgeFixture(app, mailer)
    const { uploadId } = await start(f, 100)
    const otherRoute = await app.request(`/api/v1/competitions/${f.competition.id}/routes`, {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ number: 2, holdCount: 30, categoryIds: [] }),
    })
    const otherRouteId = ((await otherRoute.json()) as { id: string }).id

    const response = await app.request(
      `/api/v1/competitions/${f.competition.id}/routes/${otherRouteId}/video/uploads/${uploadId}`,
      { headers: authHeaders(f.organizerToken) },
    )

    expect(response.status).toBe(404)
  })

  it('la lecture publique ne sert que la vidéo de SA compétition', async () => {
    const f = await createJudgeFixture(app, mailer)
    const g = await createJudgeFixture(app, mailer)
    await uploadAll(f, mp4(500))

    const wrongSlug = await app.request(
      `/api/v1/public/${publicSlugOf(g)}/routes/${f.route.id}/video`,
    )
    const unknownSlug = await app.request(`/api/v1/public/inconnu/routes/${f.route.id}/video`)
    const noVideo = await app.request(
      `/api/v1/public/${publicSlugOf(g)}/routes/${g.route.id}/video`,
    )

    expect(wrongSlug.status).toBe(404)
    expect(unknownSlug.status).toBe(404)
    expect(noVideo.status).toBe(404)
  })

  it('sans stockage configuré, les routes de téléversement ne sont pas montées', async () => {
    const bare = createApp({
      env,
      db: handle.db,
      mailer,
      logger: { info: () => {} } as unknown as Logger,
      accessTokenSigner: createAccessTokenSigner(env.JWT_ACCESS_SECRET),
      judgeTokenSigner: createJudgeTokenSigner(env.JWT_JUDGE_SECRET),
    })
    const f = await createJudgeFixture(app, mailer)
    const response = await bare.request(uploadsUrl(f), {
      method: 'POST',
      headers: authHeaders(f.organizerToken),
      body: JSON.stringify({ sizeBytes: 100, mimeType: 'video/mp4' }),
    })
    expect(response.status).toBe(404)
  })
})
