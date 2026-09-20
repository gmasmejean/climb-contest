/**
 * `virtual:pwa-register` est fabriqué par vite-plugin-pwa à la construction ;
 * Vitest ne charge pas ce plugin. Cet alias (voir `vitest.config.ts`) ne fait
 * que rendre l'import résolvable : un test qui atteint réellement ce module
 * doit le remplacer avec `vi.mock('virtual:pwa-register', …)`.
 */
export function registerSW(): never {
  throw new Error(
    "virtual:pwa-register n'existe qu'à la construction : mockez-le avec vi.mock() dans le test.",
  )
}
