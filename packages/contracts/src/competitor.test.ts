import { describe, expect, it } from 'vitest'

import {
  createCompetitorInputSchema,
  importCompetitorsInputSchema,
  importReportSchema,
} from './competitor'

describe('createCompetitorInputSchema', () => {
  it('accepte un compétiteur sans dossard (attribué plus tard)', () => {
    const result = createCompetitorInputSchema.safeParse({
      categoryId: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
      firstName: 'Léa',
      lastName: 'Martin',
    })
    expect(result.success).toBe(true)
  })

  it('refuse un dossard négatif ou nul', () => {
    const base = {
      categoryId: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
      firstName: 'Léa',
      lastName: 'Martin',
    }
    expect(createCompetitorInputSchema.safeParse({ ...base, bib: 0 }).success).toBe(false)
    expect(createCompetitorInputSchema.safeParse({ ...base, bib: -1 }).success).toBe(false)
  })

  it('refuse un prénom vide', () => {
    const result = createCompetitorInputSchema.safeParse({
      categoryId: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
      firstName: '',
      lastName: 'Martin',
    })
    expect(result.success).toBe(false)
  })
})

describe('importCompetitorsInputSchema', () => {
  it('exige un mode explicite (preview ou commit)', () => {
    expect(importCompetitorsInputSchema.safeParse({ csv: 'a,b\n1,2' }).success).toBe(false)
  })

  it('refuse un CSV vide', () => {
    expect(importCompetitorsInputSchema.safeParse({ csv: '', mode: 'preview' }).success).toBe(false)
  })
})

describe('importReportSchema', () => {
  it('valide un rapport avec une ligne en erreur', () => {
    const result = importReportSchema.safeParse({
      committed: false,
      totalRows: 1,
      validRows: 0,
      rows: [
        {
          line: 2,
          bib: null,
          firstName: 'Léa',
          lastName: 'Martin',
          categoryLabel: 'U16 Femme',
          birthYear: null,
          clubName: null,
          licenseNumber: null,
          errors: ['Catégorie « U16 Femme » introuvable.'],
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})
