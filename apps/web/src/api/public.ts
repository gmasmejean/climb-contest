import type {
  PublicCompetitionMeta,
  PublicRankingResponse,
  PublicRoute,
} from '@climbcontest/contracts'

import { apiFetch } from './client'

export const publicApi = {
  meta: (slug: string) => apiFetch<PublicCompetitionMeta>(`/public/${slug}`),
  rankings: (slug: string, categoryId: string) =>
    apiFetch<PublicRankingResponse>(
      `/public/${slug}/rankings?category=${encodeURIComponent(categoryId)}`,
    ),
  routes: (slug: string, categoryId: string) =>
    apiFetch<PublicRoute[]>(`/public/${slug}/routes?category=${encodeURIComponent(categoryId)}`),
}

/**
 * Clés TanStack Query partagées entre la page publique (qui déclenche les
 * requêtes) et `usePublicStream` côté appelant (qui les invalide sur
 * événement SSE / repli sondage) — un seul endroit qui définit la forme
 * de la clé, jamais recopiée à la main à deux endroits.
 */
export const publicQueryKeys = {
  meta: (slug: string) => ['public-meta', slug] as const,
  rankings: (slug: string, categoryId: string) => ['public-rankings', slug, categoryId] as const,
  routes: (slug: string, categoryId: string) => ['public-routes', slug, categoryId] as const,
}
