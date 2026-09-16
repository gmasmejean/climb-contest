import type { ConfigSchema } from '../../types'

export interface FfmeDifficulty2026Config {
  /** SPEC.md §4.5: M, the number of routes retained per competitor in contest format. */
  readonly routesCounted: number
}

/**
 * Hand-written validator instead of Zod: packages/scoring stays a
 * zero-dependency package (SPEC.md §6.2). A real Zod schema satisfies the
 * same structural `ConfigSchema<T>` interface without this package
 * depending on it.
 */
export const ffmeDifficulty2026ConfigSchema: ConfigSchema<FfmeDifficulty2026Config> = {
  parse(input: unknown): FfmeDifficulty2026Config {
    if (typeof input !== 'object' || input === null || !('routesCounted' in input)) {
      throw new Error(
        'scoring_config invalide pour ffme-difficulty-2026 : "routesCounted" est requis.',
      )
    }

    const { routesCounted } = input

    if (
      typeof routesCounted !== 'number' ||
      !Number.isInteger(routesCounted) ||
      routesCounted < 1
    ) {
      throw new Error(
        'scoring_config invalide pour ffme-difficulty-2026 : "routesCounted" doit être un entier ≥ 1.',
      )
    }

    return { routesCounted }
  },
}
