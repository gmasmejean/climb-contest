import { describe, expect, it } from 'vitest'

import type { Ascent, Route } from '../../types'
import { scoreAscent } from './score-ascent'

const route: Route = { id: 'route-1', holdCount: 40 }

function ascent(overrides: Partial<Ascent>): Ascent {
  return {
    competitorId: 'competitor-1',
    holdNumber: null,
    holdCount: route.holdCount,
    modifier: 'none',
    isTop: false,
    status: 'valid',
    climbTimeMs: null,
    ...overrides,
  }
}

describe('scoreAscent — SPEC.md §4.1 / §9', () => {
  it('Cas #1 — voie de 40 prises, prise 25 contrôlée', () => {
    expect(scoreAscent(ascent({ holdNumber: 25 }), route)).toBe(25)
  })

  it('Cas #2 — idem, mouvement amorcé vers la 26', () => {
    expect(scoreAscent(ascent({ holdNumber: 25, modifier: 'plus' }), route)).toBe(25.5)
  })

  it('Cas #4 — TOP', () => {
    expect(scoreAscent(ascent({ isTop: true }), route)).toBe(41)
  })

  it("Cas #5 — absent, ne s'est jamais présenté (DNS)", () => {
    expect(scoreAscent(ascent({ status: 'dns' }), route)).toBe(0)
  })

  it('Cas #6 — présenté puis retiré avant son ascension (DNS, ADR-010)', () => {
    expect(scoreAscent(ascent({ status: 'dns' }), route)).toBe(0)
  })

  it('DNF et DSQ valent aussi 0 (ADR-010 : aucune différence de calcul)', () => {
    expect(scoreAscent(ascent({ status: 'dnf', holdNumber: 30 }), route)).toBe(0)
    expect(scoreAscent(ascent({ status: 'dsq', holdNumber: 30 }), route)).toBe(0)
  })

  it('un TOP ignore holdNumber, même incohérent ou absent', () => {
    expect(scoreAscent(ascent({ isTop: true, holdNumber: null }), route)).toBe(41)
  })

  it('lève une erreur explicite si holdNumber est manquant pour un statut valid non-TOP', () => {
    expect(() => scoreAscent(ascent({ holdNumber: null }), route)).toThrow(/holdNumber est requis/)
  })

  it('lève une erreur explicite si holdNumber est hors bornes', () => {
    expect(() => scoreAscent(ascent({ holdNumber: 0 }), route)).toThrow(/hors de/)
    expect(() => scoreAscent(ascent({ holdNumber: 41 }), route)).toThrow(/hors de/)
  })
})
