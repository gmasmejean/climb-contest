import { describe, expect, it } from 'vitest'

import { ffmeDifficulty2026ConfigSchema } from './config'

describe('ffmeDifficulty2026ConfigSchema', () => {
  it('accepte une configuration valide', () => {
    expect(ffmeDifficulty2026ConfigSchema.parse({ routesCounted: 3 })).toEqual({ routesCounted: 3 })
  })

  it("rejette une entrée qui n'est pas un objet", () => {
    expect(() => ffmeDifficulty2026ConfigSchema.parse('nope')).toThrow(/requis/)
    expect(() => ffmeDifficulty2026ConfigSchema.parse(null)).toThrow(/requis/)
  })

  it('rejette un objet sans routesCounted', () => {
    expect(() => ffmeDifficulty2026ConfigSchema.parse({})).toThrow(/requis/)
  })

  it('rejette routesCounted non entier, non numérique ou négatif', () => {
    expect(() => ffmeDifficulty2026ConfigSchema.parse({ routesCounted: 1.5 })).toThrow(/entier/)
    expect(() => ffmeDifficulty2026ConfigSchema.parse({ routesCounted: 0 })).toThrow(/entier/)
    expect(() => ffmeDifficulty2026ConfigSchema.parse({ routesCounted: 'trois' })).toThrow(/entier/)
  })
})
