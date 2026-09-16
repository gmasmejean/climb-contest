import { describe, expect, it } from 'vitest'

import { getScoringEngine, registerScoringEngine } from './registry'
import type { ScoringEngine } from './types'

describe('registry', () => {
  it('enregistre puis retrouve un moteur par id', () => {
    const engine: ScoringEngine = {
      id: 'test-engine',
      label: 'Test',
      configSchema: { parse: (input: unknown) => input },
      scoreAscent: () => 0,
      rankRoute: () => ({ routeId: 'r', holdCount: 1, entries: [] }),
      rankRound: () => ({ entries: [] }),
      rankFinal: () => ({ entries: [] }),
    }

    registerScoringEngine(engine)

    expect(getScoringEngine('test-engine')).toBe(engine)
  })

  it('lève une erreur explicite pour un moteur inconnu', () => {
    expect(() => getScoringEngine('inconnu-xyz')).toThrow(/inconnu/)
  })
})
