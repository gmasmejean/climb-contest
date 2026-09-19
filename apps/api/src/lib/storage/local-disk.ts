import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

import {
  InvalidStorageKeyError,
  StorageOffsetError,
  type ByteRange,
  type StorageAdapter,
  type StoredObject,
} from './storage'

const PART_SUFFIX = '.part'
// Segments alphanumériques, tirets et soulignés, séparés par « / » : ni « .. »,
// ni chemin absolu, ni caractère de contrôle. Les clés sont construites par le
// serveur, cette garde n'existe que pour qu'un bug futur ne puisse jamais lire
// ou écrire hors de la racine.
const KEY_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/

async function sizeOrNull(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Stockage sur le disque local (`STORAGE_DRIVER=local-disk`). Un envoi vit dans
 * `<clé>.part` jusqu'à `completeUpload`, qui le renomme atomiquement : un
 * lecteur ne voit jamais un fichier à moitié écrit.
 */
export class LocalDiskStorage implements StorageAdapter {
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  private finalPath(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new InvalidStorageKeyError(key)
    const resolved = path.resolve(this.root, key)
    // Défense en profondeur : même une clé qui passe le motif ne sort pas.
    if (!resolved.startsWith(this.root + path.sep)) throw new InvalidStorageKeyError(key)
    return resolved
  }

  private partPath(key: string): string {
    return this.finalPath(key) + PART_SUFFIX
  }

  async beginUpload(key: string): Promise<void> {
    const part = this.partPath(key)
    await mkdir(path.dirname(part), { recursive: true })
    await rm(part, { force: true })
    const handle = await open(part, 'w')
    await handle.close()
  }

  async uploadedBytes(key: string): Promise<number> {
    return (await sizeOrNull(this.partPath(key))) ?? 0
  }

  async appendChunk(key: string, offset: number, chunk: Uint8Array): Promise<number> {
    const part = this.partPath(key)
    const current = await sizeOrNull(part)
    if (current === null) throw new StorageOffsetError(0)
    if (offset !== current) throw new StorageOffsetError(current)

    const handle = await open(part, 'a')
    try {
      await handle.write(chunk)
      // Sur disque avant de répondre « reçu » : c'est ce qui rend la reprise
      // fiable après un arrêt brutal du serveur.
      await handle.sync()
    } finally {
      await handle.close()
    }
    return current + chunk.byteLength
  }

  async readHead(key: string, length: number): Promise<Uint8Array> {
    const file =
      (await sizeOrNull(this.partPath(key))) !== null ? this.partPath(key) : this.finalPath(key)
    const handle = await open(file, 'r')
    try {
      const buffer = new Uint8Array(length)
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async completeUpload(key: string): Promise<{ size: number }> {
    const part = this.partPath(key)
    const size = await sizeOrNull(part)
    if (size === null) throw new StorageOffsetError(0)
    await rename(part, this.finalPath(key))
    return { size }
  }

  async abortUpload(key: string): Promise<void> {
    await rm(this.partPath(key), { force: true })
  }

  async open(key: string, range?: ByteRange): Promise<StoredObject | null> {
    const file = this.finalPath(key)
    const size = await sizeOrNull(file)
    if (size === null) return null
    const options = range ? { start: range.start, end: range.end } : {}
    const nodeStream = createReadStream(file, options)
    return { size, stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array> }
  }

  async delete(key: string): Promise<void> {
    await rm(this.finalPath(key), { force: true })
    await rm(this.partPath(key), { force: true })
  }
}
