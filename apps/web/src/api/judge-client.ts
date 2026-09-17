import { ApiError } from './client'
import { judgeToken } from './judge-session'

interface ProblemBody {
  title: string
  detail?: string
}

/**
 * Client dédié au juge : jeton Bearer distinct de celui de l'organisateur,
 * aucun mécanisme de refresh (le JWT juge vit plusieurs jours, SPEC.md § 3.2)
 * — deux acteurs, deux jetons, jamais mélangés (voir `api/client.ts`).
 * Partagé par tous les modules d'API juge (`judge-auth.ts`, `judge-ascents.ts`).
 */
export async function judgeFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
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
    throw new ApiError(response.status, body?.title ?? 'Erreur', body?.detail)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
