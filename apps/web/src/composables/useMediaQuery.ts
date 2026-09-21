import { onScopeDispose, readonly, ref, type Ref } from 'vue'

/** Seuil à partir duquel l'espace organisateur passe en mise en page large (ADR-072). */
export const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * Suit une media query. Sans `matchMedia` (vieux navigateur, tests) la requête
 * est réputée fausse : on retombe sur la mise en page mobile, qui marche partout.
 */
export function useMediaQuery(query: string): Readonly<Ref<boolean>> {
  const matches = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return readonly(matches)
  }

  const list = window.matchMedia(query)
  matches.value = list.matches
  const onChange = (event: Pick<MediaQueryListEvent, 'matches'>): void => {
    matches.value = event.matches
  }
  list.addEventListener('change', onChange)
  onScopeDispose(() => list.removeEventListener('change', onChange))

  return readonly(matches)
}
