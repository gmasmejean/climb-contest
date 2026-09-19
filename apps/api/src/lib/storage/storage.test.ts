import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadStorageConfig } from './config'
import { createStorageAdapter } from './index'
import { LocalDiskStorage } from './local-disk'
import { InvalidStorageKeyError, StorageOffsetError } from './storage'

let root: string
let storage: LocalDiskStorage
const KEY = 'competitions/abc/videos/def'

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'climbcontest-storage-'))
  storage = new LocalDiskStorage(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return new Uint8Array(Buffer.concat(chunks))
}

const bytes = (...values: number[]) => new Uint8Array(values)

describe('LocalDiskStorage — envoi par morceaux', () => {
  it('reconstitue exactement les octets envoyés, en plusieurs morceaux', async () => {
    await storage.beginUpload(KEY)
    expect(await storage.appendChunk(KEY, 0, bytes(1, 2, 3))).toBe(3)
    expect(await storage.appendChunk(KEY, 3, bytes(4, 5))).toBe(5)
    expect(await storage.completeUpload(KEY)).toEqual({ size: 5 })

    const opened = await storage.open(KEY)
    expect(opened?.size).toBe(5)
    expect(await readAll(opened!.stream)).toEqual(bytes(1, 2, 3, 4, 5))
  })

  it('refuse un offset qui ne correspond pas et annonce celui qu’il attend', async () => {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, bytes(1, 2, 3))

    const error = await storage.appendChunk(KEY, 10, bytes(9)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageOffsetError)
    expect((error as StorageOffsetError).expectedOffset).toBe(3)
  })

  it('un morceau rejoué (déjà reçu) est refusé sans rien écrire — la reprise se recale', async () => {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, bytes(1, 2, 3))

    await expect(storage.appendChunk(KEY, 0, bytes(1, 2, 3))).rejects.toBeInstanceOf(
      StorageOffsetError,
    )
    expect(await storage.uploadedBytes(KEY)).toBe(3)
  })

  it('reprend après un redémarrage : un nouvel adaptateur retrouve les octets déjà reçus', async () => {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, bytes(1, 2, 3))

    const restarted = new LocalDiskStorage(root)
    expect(await restarted.uploadedBytes(KEY)).toBe(3)
    await restarted.appendChunk(KEY, 3, bytes(4))
    await restarted.completeUpload(KEY)

    expect(await readAll((await restarted.open(KEY))!.stream)).toEqual(bytes(1, 2, 3, 4))
  })

  it('un envoi non terminé n’est pas lisible', async () => {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, bytes(1))
    expect(await storage.open(KEY)).toBeNull()
  })

  it('recommencer un envoi repart de zéro', async () => {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, bytes(1, 2, 3))
    await storage.beginUpload(KEY)
    expect(await storage.uploadedBytes(KEY)).toBe(0)
  })

  it('ajouter à un envoi qui n’existe pas demande de repartir de 0', async () => {
    const error = await storage.appendChunk(KEY, 0, bytes(1)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageOffsetError)
    expect((error as StorageOffsetError).expectedOffset).toBe(0)
  })

  it('lit les premiers octets d’un envoi en cours comme d’un objet terminé', async () => {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, bytes(10, 20, 30, 40, 50))
    expect(await storage.readHead(KEY, 3)).toEqual(bytes(10, 20, 30))
    await storage.completeUpload(KEY)
    expect(await storage.readHead(KEY, 3)).toEqual(bytes(10, 20, 30))
    expect(await storage.readHead(KEY, 100)).toEqual(bytes(10, 20, 30, 40, 50))
  })

  it('abandonner un envoi supprime ce qui a été reçu, sans erreur s’il n’existe pas', async () => {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, bytes(1))
    await storage.abortUpload(KEY)
    expect(await storage.uploadedBytes(KEY)).toBe(0)
    await expect(storage.abortUpload(KEY)).resolves.toBeUndefined()
  })
})

describe('LocalDiskStorage — lecture', () => {
  async function stored(...values: number[]) {
    await storage.beginUpload(KEY)
    await storage.appendChunk(KEY, 0, new Uint8Array(values))
    await storage.completeUpload(KEY)
  }

  it('renvoie une plage d’octets exacte (bornes incluses) et la taille totale', async () => {
    await stored(0, 1, 2, 3, 4, 5, 6, 7, 8, 9)
    const opened = await storage.open(KEY, { start: 2, end: 5 })
    expect(opened?.size).toBe(10)
    expect(await readAll(opened!.stream)).toEqual(bytes(2, 3, 4, 5))
  })

  it('renvoie null pour un objet inconnu', async () => {
    expect(await storage.open('competitions/none/videos/none')).toBeNull()
  })

  it('supprime un objet, sans erreur s’il n’existe pas', async () => {
    await stored(1, 2)
    await storage.delete(KEY)
    expect(await storage.open(KEY)).toBeNull()
    await expect(storage.delete(KEY)).resolves.toBeUndefined()
  })

  it('n’écrit qu’un fichier par objet : aucun résidu .part après la fin', async () => {
    await stored(1, 2)
    const files = await readdir(path.join(root, 'competitions/abc/videos'))
    expect(files).toEqual(['def'])
  })
})

describe('LocalDiskStorage — clés', () => {
  it.each([
    ['../etc/passwd'],
    ['/etc/passwd'],
    ['a/../../b'],
    ['a//b'],
    [''],
    ['a b'],
    ['a\0b'],
    ['a/./b'],
    ['..'],
    ['a/'],
    ['é'],
  ])('refuse la clé %j dans toutes les opérations, sans toucher au disque', async (key) => {
    await expect(storage.beginUpload(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(storage.uploadedBytes(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(storage.appendChunk(key, 0, bytes(1))).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    )
    await expect(storage.readHead(key, 1)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(storage.completeUpload(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(storage.abortUpload(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(storage.open(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    await expect(storage.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError)
    expect(await readdir(root)).toEqual([])
  })
})

describe('createStorageAdapter', () => {
  it('crée l’adaptateur disque', () => {
    expect(
      createStorageAdapter({
        STORAGE_DRIVER: 'local-disk',
        STORAGE_LOCAL_DIR: root,
        VIDEO_MAX_BYTES: 1,
      }),
    ).toBeInstanceOf(LocalDiskStorage)
  })

  it('refuse explicitement S3, non livré (ADR-058), plutôt que de faire semblant', () => {
    expect(() =>
      createStorageAdapter({ STORAGE_DRIVER: 's3', STORAGE_LOCAL_DIR: root, VIDEO_MAX_BYTES: 1 }),
    ).toThrow(/s3.*pas implémenté.*local-disk/)
  })
})

describe('loadStorageConfig', () => {
  it('applique les valeurs par défaut : disque local, 200 Mio', () => {
    expect(loadStorageConfig({})).toEqual({
      STORAGE_DRIVER: 'local-disk',
      STORAGE_LOCAL_DIR: './data/uploads',
      VIDEO_MAX_BYTES: 209_715_200,
    })
  })

  it('lit les variables et convertit la taille en nombre', () => {
    expect(
      loadStorageConfig({ STORAGE_LOCAL_DIR: '/data', VIDEO_MAX_BYTES: '1000' }).VIDEO_MAX_BYTES,
    ).toBe(1000)
  })

  it.each([['0'], ['-1'], ['abc'], ['2000000001']])('refuse VIDEO_MAX_BYTES=%s', (value) => {
    expect(() => loadStorageConfig({ VIDEO_MAX_BYTES: value })).toThrow(
      /Configuration du stockage invalide/,
    )
  })

  it('refuse un pilote inconnu', () => {
    expect(() => loadStorageConfig({ STORAGE_DRIVER: 'ftp' })).toThrow(/STORAGE_DRIVER/)
  })
})
