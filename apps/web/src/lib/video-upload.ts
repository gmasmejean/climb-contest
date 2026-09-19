import type { VideoAsset, VideoUpload } from '@climbcontest/contracts'

/**
 * Envoi d'une vidéo par morceaux, reprenable (ROADMAP.md Lot 9, point 3,
 * DECISIONS.md ADR-058). Module pur : la requête, le stockage local et
 * l'attente sont injectés pour être testés sans navigateur ni réseau.
 *
 * Reprise, dans l'ordre : (1) coupure réseau ou 5xx → nouvel essai avec repli
 * exponentiel ; (2) 409 → le serveur dit où il en est, on se recale ; (3) page
 * rechargée ou onglet fermé → l'identifiant de l'envoi est gardé localement,
 * re-sélectionner le même fichier reprend là où le serveur s'était arrêté.
 */

export interface UploadRequest {
  (path: string, init?: RequestInit): Promise<Response>
}

export interface UploadStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export interface UploadDeps {
  request: UploadRequest
  store: UploadStore
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface UploadParams {
  file: Pick<File, 'name' | 'size' | 'type' | 'lastModified' | 'slice'>
  competitionId: string
  routeId: string
  onProgress?: (sentBytes: number, totalBytes: number) => void
  signal?: AbortSignal
}

/** Erreur définitive (fichier refusé, droits…) : réessayer ne changerait rien. */
export class UploadRefusedError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

/** Le réseau ou le serveur n'a pas répondu assez longtemps : l'envoi est REPRENABLE. */
export class UploadInterruptedError extends Error {
  constructor() {
    super(
      'L’envoi a été interrompu (réseau ou serveur indisponible). Vos octets déjà envoyés sont conservés : choisissez de nouveau le même fichier pour reprendre.',
    )
  }
}

export const MAX_ATTEMPTS = 6
export const BASE_DELAY_MS = 1000
export const MAX_DELAY_MS = 30_000

const retryDelay = (attempt: number) => Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)

interface Problem {
  title?: string
  detail?: string
  expectedOffset?: number
}

async function readProblem(response: Response): Promise<Problem> {
  try {
    return (await response.json()) as Problem
  } catch {
    return {}
  }
}

function refusal(problem: Problem, status: number): UploadRefusedError {
  return new UploadRefusedError(problem.detail ?? problem.title ?? 'Envoi refusé.', status)
}

const storeKey = (params: Pick<UploadParams, 'file' | 'routeId'>) =>
  `climbcontest.video-upload.${params.routeId}.${params.file.name}.${params.file.size}.${params.file.lastModified}`

const isRetryable = (status: number) => status === 408 || status === 429 || status >= 500

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Envoi annulé.', 'AbortError')
}

export async function uploadVideo(deps: UploadDeps, params: UploadParams): Promise<VideoAsset> {
  const { request, store, sleep } = deps
  const { file, competitionId, routeId, signal } = params
  const base = `/competitions/${competitionId}/routes/${routeId}/video/uploads`
  const key = storeKey(params)

  /** Une requête, avec repli exponentiel sur coupure réseau et 5xx/429. */
  async function withRetry(send: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(signal)
      let response: Response | null = null
      try {
        response = await send()
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        // `fetch` rejette sur une coupure réseau : réessayable.
      }
      if (response && !isRetryable(response.status)) return response
      if (attempt + 1 >= MAX_ATTEMPTS) throw new UploadInterruptedError()
      await sleep(retryDelay(attempt), signal)
    }
  }

  // --- 1. Reprendre un envoi connu, sinon en ouvrir un nouveau ---
  let session: VideoUpload | null = null
  const knownId = store.get(key)
  if (knownId) {
    const status = await withRetry(() => request(`${base}/${knownId}`, { signal: signal ?? null }))
    if (status.ok) {
      const known = (await status.json()) as VideoUpload
      if (known.status === 'uploading' && known.declaredSizeBytes === file.size) session = known
    }
    if (!session) store.remove(key)
  }
  if (!session) {
    const created = await withRetry(() =>
      request(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizeBytes: file.size, mimeType: file.type }),
        signal: signal ?? null,
      }),
    )
    if (!created.ok) throw refusal(await readProblem(created), created.status)
    session = (await created.json()) as VideoUpload
    store.set(key, session.uploadId)
  }

  // --- 2. Envoyer les morceaux ---
  let offset = session.receivedBytes
  params.onProgress?.(offset, file.size)
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + session.chunkSize, file.size))
    const response = await withRetry(() =>
      request(`${base}/${session.uploadId}`, {
        method: 'PATCH',
        headers: { 'Upload-Offset': String(offset), 'Content-Type': 'application/octet-stream' },
        body: chunk,
        signal: signal ?? null,
      }),
    )

    if (response.status === 409) {
      // Le serveur a déjà reçu tout ou partie de ce morceau (réponse perdue,
      // rejeu) : il dit où il en est, on reprend là, sans rien renvoyer d'inutile.
      const problem = await readProblem(response)
      if (typeof problem.expectedOffset !== 'number') {
        store.remove(key)
        throw refusal(problem, 409)
      }
      offset = problem.expectedOffset
    } else if (response.ok) {
      offset = ((await response.json()) as VideoUpload).receivedBytes
    } else {
      store.remove(key)
      throw refusal(await readProblem(response), response.status)
    }
    params.onProgress?.(offset, file.size)
  }

  // --- 3. Terminer : le serveur vérifie le contenu réel ---
  const done = await withRetry(() =>
    request(`${base}/${session.uploadId}/complete`, { method: 'POST', signal: signal ?? null }),
  )
  if (!done.ok) {
    // Une réponse d'erreur définitive (format refusé…) : l'envoi est fini, on l'oublie.
    store.remove(key)
    throw refusal(await readProblem(done), done.status)
  }
  store.remove(key)
  return (await done.json()) as VideoAsset
}

/** Abandonne l'envoi en cours côté serveur (bouton « Annuler »). */
export async function abandonUpload(
  request: UploadRequest,
  store: UploadStore,
  params: Pick<UploadParams, 'file' | 'competitionId' | 'routeId'>,
): Promise<void> {
  const key = storeKey(params)
  const id = store.get(key)
  store.remove(key)
  if (!id) return
  await request(
    `/competitions/${params.competitionId}/routes/${params.routeId}/video/uploads/${id}`,
    {
      method: 'DELETE',
    },
  ).catch(() => undefined)
}

export function localStorageUploadStore(): UploadStore {
  return {
    get: (key) => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Stockage indisponible : la reprise après rechargement est perdue,
        // pas l'envoi en cours.
      }
    },
    remove: (key) => {
      try {
        localStorage.removeItem(key)
      } catch {
        // idem
      }
    },
  }
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Envoi annulé.', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Envoi annulé.', 'AbortError'))
      },
      { once: true },
    )
  })
}
