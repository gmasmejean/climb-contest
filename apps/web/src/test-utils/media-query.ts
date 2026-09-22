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

/**
 * Comme `stubDesktop`, mais évalue chaque `(min-width: Npx)` contre une largeur
 * donnée : indispensable depuis que deux seuils cohabitent (1024 px pour le
 * tableau, 1440 px pour le maître–détail — ADR-075).
 */
export function stubViewport(width: number): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const min = /\(min-width:\s*(\d+)px\)/.exec(query)
      return {
        matches: min?.[1] !== undefined && width >= Number(min[1]),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }
    }),
  )
}
