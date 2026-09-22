import { onScopeDispose, readonly, ref, type Ref } from 'vue'

/** Seuil à partir duquel l'espace organisateur passe en mise en page large (ADR-072). */
export const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * Seuil des colonnes facultatives (Lot 18). Entre 1024 et 1280 px, un tableau
 * de neuf colonnes écrase les noms à une vingtaine de pixels : les colonnes de
 * confort n'apparaissent qu'au-delà.
 */
export const WIDE_QUERY = '(min-width: 1280px)'

/**
 * Seuil du maître–détail (ADR-075), MESURÉ et non choisi : les largeurs fixes
 * du tableau des voies totalisent 656 px (528 px pour celui des juges). Avec la
 * barre latérale de 15 rem et un panneau de 24 rem, la liste ne retrouve ces
 * 656 px qu'à partir de 1440 px ; en dessous, le tableau déborde sa colonne et
 * passe SOUS le panneau collant, qui intercepte alors les clics.
 * À garder en phase avec la variante `min-[1440px]:` des écrans concernés.
 */
export const MASTER_DETAIL_QUERY = '(min-width: 1440px)'

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
