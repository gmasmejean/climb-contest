import type {
  JudgeAccessInfo,
  JudgeAuthInput,
  JudgeMe,
  JudgeSession,
} from '@climbcontest/contracts'

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
 */
async function judgeFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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
  return (await response.json()) as T
}

export const judgeAuthApi = {
  access: (token: string) => judgeFetch<JudgeAccessInfo>(`/access/${encodeURIComponent(token)}`),
  auth: (input: JudgeAuthInput) =>
    judgeFetch<JudgeSession>('/auth', { method: 'POST', body: JSON.stringify(input) }),
  me: () => judgeFetch<JudgeMe>('/me'),
}
