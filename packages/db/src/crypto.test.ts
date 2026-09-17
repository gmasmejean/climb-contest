import { describe, expect, it } from 'vitest'

import { hashToken, randomPin, randomToken } from './crypto'

describe('randomToken', () => {
  it('génère un jeton de la longueur demandée, en base62', () => {
    const token = randomToken(32)
    expect(token).toHaveLength(32)
    expect(token).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('ne génère jamais deux fois le même jeton', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => randomToken(16)))
    expect(tokens.size).toBe(1000)
  })

  it("n'a pas de biais modulo détectable sur un grand échantillon (rejection sampling)", () => {
    // Avant correctif : `byte % 62` sur-représentait les 8 premiers
    // caractères de l'alphabet (valeurs d'octet 248-255). Sur un échantillon
    // de cette taille, un biais de ce type produirait un écart bien plus
    // grand que la marge tolérée ici.
    const counts = new Map<string, number>()
    const sampleSize = 20_000
    for (const char of randomToken(sampleSize)) {
      counts.set(char, (counts.get(char) ?? 0) + 1)
    }
    const expected = sampleSize / 62
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.7)
      expect(count).toBeLessThan(expected * 1.3)
    }
  })
})

describe('randomPin', () => {
  it('génère un PIN à 6 chiffres', () => {
    const pin = randomPin()
    expect(pin).toMatch(/^\d{6}$/)
  })

  it('couvre bien des PIN différents sur plusieurs tirages', () => {
    const pins = new Set(Array.from({ length: 200 }, () => randomPin()))
    expect(pins.size).toBeGreaterThan(150)
  })
})

describe('hashToken', () => {
  it('est déterministe (permet une recherche WHERE token_hash = …)', () => {
    const token = randomToken(32)
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('produit des hachages différents pour des jetons différents', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})
