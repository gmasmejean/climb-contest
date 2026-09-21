import { vi } from 'vitest'

/**
 * jsdom fournit `matchMedia` mais n'évalue aucune requête : `matches` y vaut
 * toujours `false`, donc les écrans s'y rendent en cartes. Ce stub sert aux
 * tests qui veulent la disposition en tableau des grands écrans (Lot 18).
 *
 * Penser à `vi.unstubAllGlobals()` dans un `afterEach`.
 */
export function stubDesktop(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  )
}
