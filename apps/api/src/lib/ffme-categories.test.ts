import { describe, expect, it } from 'vitest'

import { buildFfmeTemplateCategories, seasonYear } from './ffme-categories'

describe('seasonYear', () => {
  it('retourne 2022 pour le tout début de la saison 2022 (01/09/2021)', () => {
    expect(seasonYear('2021-09-01')).toBe(2022)
  })

  it('retourne 2022 pour la toute fin de la saison 2022 (31/08/2022)', () => {
    expect(seasonYear('2022-08-31')).toBe(2022)
  })

  it('retourne la même année pour une compétition en cœur de saison (janvier)', () => {
    expect(seasonYear('2022-01-15')).toBe(2022)
  })

  it('bascule sur l’année suivante dès le 1er septembre', () => {
    expect(seasonYear('2025-09-01')).toBe(2026)
    expect(seasonYear('2025-08-31')).toBe(2025)
  })
})

describe('buildFfmeTemplateCategories', () => {
  it('produit 14 catégories (7 tranches × 2 sexes)', () => {
    expect(buildFfmeTemplateCategories('2026-05-01')).toHaveLength(14)
  })

  it('calcule les bornes U12 (10-11 ans) pour la saison 2022', () => {
    const categories = buildFfmeTemplateCategories('2021-09-01') // saison 2022
    const u12 = categories.find((c) => c.label === 'U12 Femme')
    expect(u12?.birthYearMin).toBe(2011)
    expect(u12?.birthYearMax).toBe(2012)
  })

  it('laisse Vétéran ouvert vers le haut (pas de birthYearMin)', () => {
    const categories = buildFfmeTemplateCategories('2021-09-01') // saison 2022
    const veteran = categories.find((c) => c.label === 'Vétéran Homme')
    expect(veteran?.birthYearMin).toBeNull()
    expect(veteran?.birthYearMax).toBe(1982)
  })

  it('donne à chaque catégorie un display_order distinct et croissant', () => {
    const categories = buildFfmeTemplateCategories('2026-05-01')
    const orders = categories.map((c) => c.displayOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(new Set(orders).size).toBe(orders.length)
  })
})
