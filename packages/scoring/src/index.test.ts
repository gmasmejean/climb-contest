import { describe, expect, it } from 'vitest'

import { ffmeDifficulty2026Engine, getScoringEngine } from './index'

describe('index — enregistrement du moteur au chargement du paquet', () => {
  it("ffme-difficulty-2026 est enregistré dès l'import du paquet", () => {
    expect(getScoringEngine('ffme-difficulty-2026')).toBe(ffmeDifficulty2026Engine)
  })
})
