const STORAGE_PREFIX = 'climbcontest:public-category:'

/**
 * Mémorise la dernière catégorie choisie sur `/c/<slug>`, par compétition
 * (ROADMAP.md Lot 7 : « sélecteur de catégorie, mémorisé localement »).
 * Même idiome défensif que `useFormDraft.ts` (essai/échec silencieux :
 * navigation privée, quota dépassé) — un confort, jamais une garantie.
 */
export function usePublicCategoryPreference(slug: string): {
  get(): string | null
  set(categoryId: string): void
} {
  const key = STORAGE_PREFIX + slug

  return {
    get() {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(categoryId: string) {
      try {
        localStorage.setItem(key, categoryId)
      } catch {
        // Rien de plus à faire : confort seulement.
      }
    },
  }
}
