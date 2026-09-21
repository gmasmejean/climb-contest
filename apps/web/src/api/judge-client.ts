import { ApiError } from './client'
import { judgeToken } from './judge-session'

interface ProblemBody {
  title: string
  detail?: string
  code?: string
}

/**
 * Envoie la requête avec le jeton juge et transforme toute réponse d'erreur
 * en `ApiError` (RFC 9457). Partagé par `judgeFetch` (JSON) et
 * `judgeFetchBytes` (fichier).
 */
async function send(path: string, options: RequestInit, withJsonBody: boolean): Promise<Response> {
  const headers = new Headers(options.headers)
  if (withJsonBody) headers.set('Content-Type', 'application/json')
  if (judgeToken.value) {
    headers.set('Authorization', `Bearer ${judgeToken.value}`)
  }

  const response = await fetch(`/api/v1/judge${path}`, { ...options, headers })

  if (!response.ok) {
    let body: ProblemBody | undefined
    try {
      body = (await response.json()) as ProblemBody
    } catch {
      body = undefined
    }
    throw new ApiError(response.status, body?.title ?? 'Erreur', body?.detail, body?.code)
  }
  return response
}

/**
 * Client dédié au juge : jeton Bearer distinct de celui de l'organisateur,
 * aucun mécanisme de refresh (le JWT juge vit plusieurs jours, SPEC.md § 3.2)
 * — deux acteurs, deux jetons, jamais mélangés (voir `api/client.ts`).
 * Partagé par tous les modules d'API juge (`judge-auth.ts`, `judge-ascents.ts`).
 */
export async function judgeFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await send(path, options, true)
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export interface JudgeFile {
  bytes: ArrayBuffer
  mimeType: string
}

/**
 * Télécharge un fichier (la photo d'une voie, ADR-066). Renvoie les octets
 * plutôt qu'un `Blob` : on les range dans IndexedDB, où un `ArrayBuffer` est
 * fiable sur tous les téléphones, y compris les plus anciens.
 */
export async function judgeFetchBytes(path: string): Promise<JudgeFile> {
  const response = await send(path, {}, false)
  return {
    bytes: await response.arrayBuffer(),
    mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
  }
}
