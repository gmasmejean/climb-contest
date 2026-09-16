import { describe, expect, it } from 'vitest'

import {
  createCategoryInputSchema,
  reorderCategoriesInputSchema,
  updateCategoryInputSchema,
} from './category'

describe('createCategoryInputSchema', () => {
  it('accepte une catégorie libre sans bornes d’âge', () => {
    const result = createCategoryInputSchema.safeParse({ label: 'Open', sex: 'X' })
    expect(result.success).toBe(true)
  })

  it('accepte des bornes d’âge nulles (catégorie ouverte, ex. Vétéran)', () => {
    const result = createCategoryInputSchema.safeParse({
      label: 'Vétéran Homme',
      sex: 'M',
      birthYearMin: null,
      birthYearMax: 1986,
    })
    expect(result.success).toBe(true)
  })

  it('refuse un sexe hors énumération', () => {
    expect(createCategoryInputSchema.safeParse({ label: 'U16', sex: 'H' }).success).toBe(false)
  })

  it('refuse un libellé vide', () => {
    expect(createCategoryInputSchema.safeParse({ label: '', sex: 'F' }).success).toBe(false)
  })
})

describe('updateCategoryInputSchema', () => {
  it('accepte une mise à jour partielle', () => {
    expect(updateCategoryInputSchema.safeParse({ label: 'U16 Femme' }).success).toBe(true)
  })
})

describe('reorderCategoriesInputSchema', () => {
  it('refuse une liste vide', () => {
    expect(reorderCategoriesInputSchema.safeParse({ orderedIds: [] }).success).toBe(false)
  })
})
