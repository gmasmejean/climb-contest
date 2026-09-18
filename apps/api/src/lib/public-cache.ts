import type { PublicRankingResponse } from '@climbcontest/contracts'

/**
 * Cache mémoire du classement public (ADR-013 : « le résultat est caché
 * côté serveur et invalidé à chaque passage »). Granularité par
 * (compétition, catégorie) plutôt que par compétition entière : les
 * événements d'écriture connaissent déjà la ou les catégories concernées
 * sans coût supplémentaire (voir `lib/public-ranking.ts`), donc une
 * invalidation ciblée n'écrase jamais le cache des catégories non
 * affectées de la même compétition — utile en format phases, où plusieurs
 * catégories tournent en parallèle sur des voies différentes.
 *
 * Recalcul paresseux au prochain `GET` (pas de recalcul proactif). Le TTL
 * est un filet de sécurité si un `NOTIFY` était un jour manqué (ex.
 * redémarrage de l'API entre l'écriture et la reconnexion du bridge) — pas
 * le mécanisme d'invalidation normal, qui est explicite.
 */
export interface PublicRankingCache {
  get(competitionId: string, categoryId: string): PublicRankingResponse | undefined
  set(competitionId: string, categoryId: string, value: PublicRankingResponse): void
  invalidateCategory(competitionId: string, categoryId: string): void
  invalidateCompetition(competitionId: string): void
}

interface CacheEntry {
  value: PublicRankingResponse
  expiresAt: number
}

const DEFAULT_TTL_MS = 20_000

function cacheKey(competitionId: string, categoryId: string): string {
  return `${competitionId}:${categoryId}`
}

export function createPublicRankingCache(
  ttlMs = DEFAULT_TTL_MS,
  now: () => number = Date.now,
): PublicRankingCache {
  const entries = new Map<string, CacheEntry>()

  return {
    get(competitionId, categoryId) {
      const entry = entries.get(cacheKey(competitionId, categoryId))
      if (!entry) return undefined
      if (entry.expiresAt <= now()) {
        entries.delete(cacheKey(competitionId, categoryId))
        return undefined
      }
      return entry.value
    },
    set(competitionId, categoryId, value) {
      entries.set(cacheKey(competitionId, categoryId), { value, expiresAt: now() + ttlMs })
    },
    invalidateCategory(competitionId, categoryId) {
      entries.delete(cacheKey(competitionId, categoryId))
    },
    invalidateCompetition(competitionId) {
      const prefix = `${competitionId}:`
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key)
      }
    },
  }
}
